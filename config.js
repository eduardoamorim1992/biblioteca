/* Configuração do backend.
 *
 * A chave `anon` é publicável por natureza: ela vai parar no navegador de
 * qualquer visitante, então tratá-la como segredo é ilusão. Quem protege os
 * dados é o RLS definido em supabase/schema.sql — se houver furo lá, o furo
 * é no banco, não aqui.
 *
 * A chave `service_role` NUNCA entra neste arquivo. */
window.BIBLIOTECA_CONFIG = {
  url: "https://mrsznhixwslwghqkjjdn.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yc3puaGl4d3Nsd2docWtqamRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NzkwNjMsImV4cCI6MjEwMTI1NTA2M30.w8zso75Ty5vLe69qRthVYs03Q_VcZc9zsmNru7U0m2k"
};
