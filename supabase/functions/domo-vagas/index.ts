// Gestão transferida para Diamond. A base e o histórico permanecem preservados.
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type, x-token, x-senha, x-quem','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
Deno.serve((req:Request)=>req.method==='OPTIONS'?new Response('ok',{headers}):new Response(JSON.stringify({error:'As vagas agora são gerenciadas no Diamond. Abra a aba Vagas de garagem no sistema de vendas.',destino:'https://leogpereira-afk.github.io/diamond/#/admin/vagas'}),{status:410,headers}));
