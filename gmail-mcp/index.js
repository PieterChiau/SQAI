/**
 * Gmail MCP Server — exposes a `send_email` tool via stdio.
 * Requires credentials.json and token.json in the same directory.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { readFileSync } from "fs";

// ── Auth ──────────────────────────────────────────────────────────────────────
const credentials = JSON.parse(readFileSync(new URL("credentials.json", import.meta.url)));
const token = JSON.parse(readFileSync(new URL("token.json", import.meta.url)));
const { client_id, client_secret, redirect_uris } = credentials.installed;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oauth2Client.setCredentials(token);

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildRawMessage({ to, cc, bcc, subject, body, isHtml }) {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    isHtml
      ? `Content-Type: text/html; charset="UTF-8"`
      : `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ]
    .filter((l) => l !== null)
    .join("\r\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "gmail-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send_email",
      description: "Send an email via Gmail.",
      inputSchema: {
        type: "object",
        required: ["to", "subject", "body"],
        properties: {
          to: { type: "string", description: "Recipient address(es), comma-separated" },
          cc: { type: "string", description: "CC address(es), comma-separated" },
          bcc: { type: "string", description: "BCC address(es), comma-separated" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (plain text or HTML)" },
          isHtml: {
            type: "boolean",
            description: "Set true if body is HTML (default: false)",
            default: false,
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "send_email") {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }

  const { to, cc, bcc, subject, body, isHtml = false } = req.params.arguments;

  try {
    const raw = buildRawMessage({ to, cc, bcc, subject, body, isHtml });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return {
      content: [
        {
          type: "text",
          text: `Email sent successfully. Message ID: ${res.data.id}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to send email: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
