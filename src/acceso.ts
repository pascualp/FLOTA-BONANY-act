// Quién puede entrar en la gestión de la flota (25/11/2026, Facu: «que solo se entre con mi cuenta y la de Gmail de
// Bon Any»). Antes valía CUALQUIER cuenta de Google: bastaba con pulsar «Entrar con Google».
//
// La MISMA lista tiene que estar en tres sitios, y si se añade a alguien hay que cambiar los tres:
//  1. aquí (la web y las funciones de Vercel: /api/documentos y /api/reporte-diario);
//  2. firestore.rules → función isStaff() (lo que de verdad protege los datos; se publica en la consola de Firebase);
//  3. si es para Telegram, el bot tiene su propia lista (TELEGRAM_CHATS y el alta con ✅ desde el grupo).
export const CORREOS_PERMITIDOS = ['porteousfacundo@gmail.com', 'fruitesbonany20@gmail.com'];

// Correo verificado por Google y en la lista. Sin correo (sesión anónima de los repartidores de Abonos): no.
export const tieneAcceso = (email: string | null | undefined, verificado: boolean | undefined) =>
  !!email && verificado === true && CORREOS_PERMITIDOS.includes(email.trim().toLowerCase());

export const AVISO_SIN_ACCESO = (email: string | null | undefined) =>
  `La cuenta ${email || 'con la que has entrado'} no tiene permiso para la gestión de la flota. ` +
  `Entra con la cuenta de Facu o con la de Bon Any (fruitesbonany20@gmail.com).`;
