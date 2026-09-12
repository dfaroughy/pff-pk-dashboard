export function PlotScaleToggle({ logY, onChange, plot }: { logY: boolean; onChange: (logY: boolean) => void; plot: string }) {
  return <button className="plot-scale-switch" type="button" role="switch"
    aria-label={`${plot} linear scale`} aria-checked={!logY} onClick={() => onChange(!logY)}
  ><span>Log</span><i aria-hidden="true" /><span>Lin</span></button>;
}
