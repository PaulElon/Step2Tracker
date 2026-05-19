const DEMO_KEY = "tf:demo:v1";

export function loadDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveDemoMode(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem(DEMO_KEY, "true");
    } else {
      localStorage.removeItem(DEMO_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}
