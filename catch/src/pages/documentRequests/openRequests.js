// The requests still in progress (OPEN or SENT) from document_request_context(), oldest first. Several can be open at
// once (20261205_several_document_requests.sql: 'open'); before that migration the context had one 'current'.
export const openRequestsOf = (ctx) => ctx?.open ?? (ctx?.current ? [ctx.current] : []);
