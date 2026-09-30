import { authorizeInternalApiBearer } from "@/lib/internal-api-auth";
import { DOCKETFLOW_MCP_TOOLS, ToolUserError } from "@/lib/mcp/docketflow-tools";
import { resolveCaller, slackUserEmail, verifySlackSignature, type McpCaller } from "@/lib/mcp/identity";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * DocketFlow MCP server for the Slackbot MCP client (stateless Streamable HTTP, JSON responses).
 * Slack requests are authenticated by `X-Slack-Signature`; the caller comes from `params._meta.slack.user_id`.
 * Server-to-server testing: `Authorization: Bearer <DOCKETFLOW_INTERNAL_API_SECRET>` + `X-DocketFlow-Acting-Email`.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown> & {
    _meta?: { slack?: { user_id?: string; team_id?: string; enterprise_id?: string } };
  };
};

type AuthMode = { kind: "slack" } | { kind: "internal"; actingEmail: string | null };

const toolsByName = new Map(DOCKETFLOW_MCP_TOOLS.map((t) => [t.name, t]));

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function authenticate(req: Request, rawBody: string): AuthMode | null {
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (signature) {
    if (!signingSecret) return null;
    return verifySlackSignature(
      rawBody,
      req.headers.get("x-slack-request-timestamp"),
      signature,
      signingSecret
    )
      ? { kind: "slack" }
      : null;
  }
  if (authorizeInternalApiBearer(req.headers.get("authorization"))) {
    return {
      kind: "internal",
      actingEmail: req.headers.get("x-docketflow-acting-email")?.trim().toLowerCase() || null,
    };
  }
  return null;
}

async function callerFor(
  auth: AuthMode,
  msg: JsonRpcRequest,
  supabase: NonNullable<ReturnType<typeof createServiceRoleClient>>
): Promise<McpCaller> {
  if (auth.kind === "internal") {
    if (!auth.actingEmail) throw new ToolUserError("X-DocketFlow-Acting-Email header is required");
    return resolveCaller(supabase, auth.actingEmail, null);
  }
  const slackUserId = msg.params?._meta?.slack?.user_id?.trim();
  if (!slackUserId) throw new ToolUserError("Missing Slack user identity on this request.");
  const email = await slackUserEmail(slackUserId);
  if (!email) throw new ToolUserError("Could not read your Slack profile email.");
  return resolveCaller(supabase, email, slackUserId);
}

async function handleMessage(
  msg: JsonRpcRequest,
  auth: AuthMode,
  supabase: NonNullable<ReturnType<typeof createServiceRoleClient>>
): Promise<Record<string, unknown> | null> {
  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid Request");
  }
  if (isNotification) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "docketflow", title: "DocketFlow", version: "1.0.0" },
        instructions:
          "DocketFlow is Ramos James Law's case calendar and paralegal checklist. Identify cases by firm case number. Times are US Central (America/Chicago). Before any write tool, restate the change and get the user's confirmation. There are no delete tools.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: DOCKETFLOW_MCP_TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations,
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = toolsByName.get(name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== "object" || Array.isArray(args)) {
        return rpcError(id, -32602, "arguments must be an object");
      }
      let who = "unknown";
      try {
        const caller = await callerFor(auth, msg, supabase);
        who = caller.email;
        const out = await tool.handler(args, { supabase, caller });
        console.info("[mcp] tool ok", { tool: name, caller: who, via: auth.kind });
        return rpcResult(id, toolText(out));
      } catch (e) {
        if (e instanceof ToolUserError) {
          console.info("[mcp] tool rejected", { tool: name, caller: who, reason: e.message });
          return rpcResult(id, toolText(e.message, true));
        }
        const message =
          e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
        console.error("[mcp] tool failed", { tool: name, caller: who }, e);
        return rpcResult(id, toolText(`DocketFlow error: ${message}`, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const auth = authenticate(req, rawBody);
  if (!auth) {
    return Response.json(rpcError(null, -32001, "Unauthorized"), { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return Response.json(rpcError(null, -32603, "Server database not configured"), { status: 503 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const batch = Array.isArray(parsed);
  const messages = (batch ? parsed : [parsed]) as JsonRpcRequest[];
  const responses = (
    await Promise.all(messages.map((m) => handleMessage(m ?? {}, auth, supabase)))
  ).filter((r): r is Record<string, unknown> => r !== null);

  if (!responses.length) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}

export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
