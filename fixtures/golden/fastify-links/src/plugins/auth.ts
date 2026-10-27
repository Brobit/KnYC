import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    /** A preHandler for routes that change links. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** The token a request carries in "Authorization: Bearer <token>", if any. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

export const authPlugin = fp<{ adminToken: string }>(
  async (app, options) => {
    app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
      if (bearerToken(request.headers.authorization) !== options.adminToken) {
        await reply.code(401).send({ error: "an admin token is required" });
      }
    });
  },
  { name: "auth" },
);
