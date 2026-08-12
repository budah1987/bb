export const DESKTOP_MEMORY_PRESSURE_FREE_RATIO = 0.05;
export const DESKTOP_MEMORY_PRESSURE_FREE_KB = 512 * 1024;
export const DESKTOP_MEMORY_PRESSURE_APP_WORKING_SET_KB = 1.5 * 1024 * 1024;

interface DesktopMemoryPressureSample {
  appWorkingSetKb: number;
  freeSystemMemoryKb: number;
  totalSystemMemoryKb: number;
}

export function shouldTrimDesktopBrowserViews(
  sample: DesktopMemoryPressureSample,
): boolean {
  const freeRatio =
    sample.totalSystemMemoryKb <= 0
      ? 1
      : sample.freeSystemMemoryKb / sample.totalSystemMemoryKb;
  return (
    sample.appWorkingSetKb >= DESKTOP_MEMORY_PRESSURE_APP_WORKING_SET_KB ||
    sample.freeSystemMemoryKb <= DESKTOP_MEMORY_PRESSURE_FREE_KB ||
    freeRatio <= DESKTOP_MEMORY_PRESSURE_FREE_RATIO
  );
}
