import { z } from "zod";

type Method = "get" | "post" | "put" | "patch" | "delete";

interface RegisteredRoute {
  method: Method;
  path: string;
  summary: string;
  tags: string[];
  auth: "none" | "optional" | "user" | "admin" | "internal";
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

const routes: RegisteredRoute[] = [];

export function registerRoute(route: RegisteredRoute): void {
  routes.push(route);
}

const toJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
};

function parametersFrom(schema: z.ZodType | undefined, location: "query" | "path") {
  if (!schema) return [];
  const json = toJsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === "path" ? true : (json.required ?? []).includes(name),
    schema: s,
  }));
}

/** Builds an OpenAPI 3.1 document from the routes declared with `defineRoute`. */
export function buildOpenApiDocument(basePath = "/api/v1"): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const oaPath = (basePath + r.path).replace(/:([A-Za-z_]+)/g, "{$1}");
    const security =
      r.auth === "user" || r.auth === "admin"
        ? [{ bearerAuth: [] }]
        : r.auth === "internal"
          ? [{ internalKey: [] }]
          : r.auth === "optional"
            ? [{}, { bearerAuth: [] }]
            : [];
    paths[oaPath] ??= {};
    paths[oaPath][r.method] = {
      summary: r.summary,
      tags: r.tags,
      security,
      parameters: [...parametersFrom(r.params, "path"), ...parametersFrom(r.query, "query")],
      ...(r.body
        ? { requestBody: { required: true, content: { "application/json": { schema: toJsonSchema(r.body) } } } }
        : {}),
      responses: {
        "200": { description: "OK" },
        "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ...(r.auth === "user" || r.auth === "admin" ? { "401": { description: "Unauthenticated" } } : {}),
        ...(r.auth === "admin" ? { "403": { description: "Forbidden" } } : {}),
      },
      ...(r.auth === "admin" ? { description: "Requires ADMIN role." } : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "ShopSense API",
      version: "1.0.0",
      description: "E-commerce backend with ML recommendations, hybrid search and an AI shopping assistant.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        internalKey: { type: "apiKey", in: "header", name: "x-internal-key" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, details: {}, requestId: { type: "string" } },
            },
          },
        },
      },
    },
    paths,
  };
}
