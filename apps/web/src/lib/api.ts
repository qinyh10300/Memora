import type { paths } from "@memora/api-contract";
import createClient from "openapi-fetch";

export const api = createClient<paths>({
  baseUrl: "/api",
  credentials: "include",
});
