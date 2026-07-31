// CORS: o app roda no GitHub Pages, domínio diferente do da Edge Function
// (*.supabase.co) — sem estes cabeçalhos o navegador bloqueia a chamada antes
// mesmo de ela chegar aqui. "*" é seguro porque a autorização de verdade é o
// TOKEN + a SENHA nos headers, conferidos dentro da função, não a origem.
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-token, x-senha, x-quem",
  "access-control-allow-methods": "POST, OPTIONS",
} as const;

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : null;
}
