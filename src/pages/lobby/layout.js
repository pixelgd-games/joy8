const MOBILE_AGENT = /Android|iPhone|iPod|Mobile|IEMobile|Opera Mini/i

export function detectLayout(nav = navigator) {
  const mobile = typeof nav.userAgentData?.mobile === "boolean" ? nav.userAgentData.mobile : MOBILE_AGENT.test(nav.userAgent || "")
  return mobile ? "mobile" : "pc"
}
