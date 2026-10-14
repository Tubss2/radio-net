import { updateFlowCopy, type UpdateFlow } from '../../shared/updates';
import { requestUpdateDownload, requestUpdateInstall, requestUpdateRetry } from './lib/updateSession';

/** Version, progress, and the download / retry / restart actions. */
export function UpdateCard({ flow, onLater }: { flow: UpdateFlow; onLater?: () => void }) {
  const copy = updateFlowCopy(flow);
  if (!copy) return null;
  const width = copy.percent == null ? undefined : `${Math.min(100, Math.max(0, copy.percent))}%`;
  return (
    <div className="update-card">
      <div className="update-top">
        <span>{copy.title}</span>
        {copy.version && <span className="ver">Radio Net {copy.version} · unsigned</span>}
      </div>
      {copy.meter && (
        <div
          className={copy.indeterminate ? 'update-meter indeterminate' : 'update-meter'}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={copy.indeterminate || copy.percent == null ? undefined : Math.round(copy.percent)}
          aria-label={copy.meterLabel}
        >
          <span style={copy.indeterminate ? undefined : { width }} />
        </div>
      )}
      <p className="update-stats">{copy.detail}</p>
      <div className="update-actions">
        {copy.showDownload && <button className="btn sm primary" type="button" onClick={requestUpdateDownload}>Download</button>}
        {copy.showRetry && <button className="btn sm primary" type="button" onClick={requestUpdateRetry}>Retry</button>}
        {copy.showInstall && <button className="btn sm primary" type="button" onClick={requestUpdateInstall}>Restart to install</button>}
        {onLater && <button className="btn sm ghost" type="button" onClick={onLater}>Later</button>}
      </div>
    </div>
  );
}
