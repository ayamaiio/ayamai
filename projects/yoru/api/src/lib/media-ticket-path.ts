// Only GET/HEAD transports authenticate opaque media tickets instead of Clerk cookies.
// Every transport must recheck the ticket viewer's current admission.
export function isMediaTicketRequest(method: string, path: string) {
  return (method === "GET" || method === "HEAD") && (
    /^\/streams\/[^/]+$/.test(path) ||
    /^\/gallery-streams\/[^/]+\/[^/]+$/.test(path) ||
    /^\/media\/[^/]+\/preview\/image$/.test(path));
}
