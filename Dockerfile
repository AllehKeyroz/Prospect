FROM node:24-bookworm-slim

WORKDIR /app
EXPOSE 3000

# Container mínimo de diagnóstico. Não usa npm, TypeScript nem banco.
# Se este container não responder, o problema está no serviço/porta/dominio
# do EasyPanel, não no build da aplicação.
CMD ["node", "-e", "require('http').createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('prospect-debug-ok\\n')}).listen(3000,'0.0.0.0')"]
