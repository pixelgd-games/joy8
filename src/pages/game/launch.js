export function gameLaunchPayload(session, supabaseUrl) {
  if (!session?.session_id || !session.launch_code || !session.game_id || session.currency !== "POINT" || session.protocol !== "server-v1" || !supabaseUrl) {
    throw new Error("Invalid Joy8 launch configuration")
  }
  return {
    joy8_session_id: session.session_id,
    joy8_launch_code: session.launch_code,
    joy8_game_id: session.game_id,
    joy8_currency: "POINT",
    joy8_gateway_url: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/joy8-gateway`,
    joy8_protocol: "server-v1",
  }
}
