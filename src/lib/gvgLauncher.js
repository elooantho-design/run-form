export function getInitialPortalTab(search = "") {
  return new URLSearchParams(search).get("gvgLauncher") === "manual" ? "launcher" : "home";
}
