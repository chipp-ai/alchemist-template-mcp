/**
 * API key management (session-authenticated REST).
 *
 * Keys are the SECONDARY auth method for /api/mcp (OAuth is primary -- see
 * docs/mcp-server.md § Authentication). Mint here, paste into headless
 * clients as `Authorization: Bearer mcp_sk_...`.
 *
 *   GET    /api/api-keys      -- list the caller's keys (metadata only)
 *   POST   /api/api-keys      -- mint; response includes the plaintext ONCE
 *   DELETE /api/api-keys/:id  -- revoke (idempotent)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getUser, requireAuth } from "@/api/middleware/auth.ts";
import { validationHook } from "@/utils/zod-validation-hook.ts";
import { BadRequestError } from "@/utils/errors.ts";
import { apiKeyService } from "@/services/api-key.service.ts";
import { ALL_MCP_SCOPES } from "@/services/mcp-oauth/permissions.ts";

const apiKeyRoutes = new Hono();

const mintSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  scopes: z.array(z.enum(ALL_MCP_SCOPES)).optional(),
});

apiKeyRoutes.get("/", requireAuth, async (c) => {
  const user = getUser(c);
  const keys = await apiKeyService.listForUser(user.id);
  return c.json({ data: { keys } });
});

apiKeyRoutes.post(
  "/",
  requireAuth,
  zValidator("json", mintSchema, validationHook),
  async (c) => {
    const user = getUser(c);
    const { name, scopes } = c.req.valid("json");
    const minted = await apiKeyService.mint({ userId: user.id, name, scopes });
    return c.json({
      data: {
        key: minted, // .key is the plaintext -- shown once, never again
        warning: "Store this key now. It cannot be retrieved again.",
      },
    }, 201);
  },
);

apiKeyRoutes.delete("/:id", requireAuth, async (c) => {
  const user = getUser(c);
  const id = c.req.param("id");
  if (!id) throw new BadRequestError("Missing key id");
  await apiKeyService.revoke(id, user.id);
  return c.json({ data: { revoked: true } });
});

export { apiKeyRoutes };
