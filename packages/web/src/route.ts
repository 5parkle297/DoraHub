/** 极简路由（无 react-router 依赖，hash 路由够用）。 */
import { useEffect, useState } from "react";

export type Route =
  | { page: "conversations" }
  | { page: "conversation"; id: string };

function parse(): Route {
  const hash = location.hash.replace(/^#/, "");
  const m = hash.match(/^\/conversations\/(.+)$/);
  if (m) return { page: "conversation", id: decodeURIComponent(m[1]) };
  return { page: "conversations" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(route: Route) {
  location.hash =
    route.page === "conversation" ? `/conversations/${encodeURIComponent(route.id)}` : "/conversations";
}
