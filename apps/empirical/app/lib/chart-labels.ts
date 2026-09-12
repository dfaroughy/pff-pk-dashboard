export function concentrationLabel(unit: string): string {
  return unit === "dimensionless concentration" ? "Concentration" : `Concentration (${unit})`;
}
