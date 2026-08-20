import { useEffect, useState } from 'react';
import { AlertTriangle, GitBranch } from 'lucide-react';
import { api } from '../api';

/**
 * Which lead pipelines this branch appears in.
 *
 * A unit can run pipelines with almost nothing in common -- admissions,
 * franchise sales, a solar business -- while every branch picker on every one
 * of those screens offers all twenty branches. Narrowing a branch here takes
 * it out of the pipelines it has no part in.
 *
 * Ticking nothing means every pipeline, which is what every branch is today.
 * That reads oddly next to the WhatsApp section above, where nothing ticked
 * means nothing selected -- so the panel says so in words rather than leaving
 * an empty set to be guessed at. The alternative, treating empty as "hidden
 * everywhere", would empty every picker in the product the first time someone
 * opened this and pressed save.
 */
export default function BranchPipelineSettings({ branchId, value, onChange }) {
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selected = value?.pipelineIds || [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pipelineResult, mappingResult] = await Promise.all([
          api('/leads/pipelines'),
          api('/branches/pipelines'),
        ]);
        if (cancelled) return;
        setPipelines(pipelineResult.data || []);
        const mine = branchId
          ? (mappingResult.data || [])
            .filter(row => Number(row.branchId) === Number(branchId))
            .map(row => Number(row.pipelineId))
          : [];
        onChange(prev => ({ ...(prev || {}), pipelineIds: mine, original: mine, loaded: true }));
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Reloading on value/onChange would fight the edits being made here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const toggle = id => onChange(prev => {
    const current = prev?.pipelineIds || [];
    return {
      ...(prev || {}),
      loaded: true,
      pipelineIds: current.includes(id) ? current.filter(x => x !== id) : [...current, id],
    };
  });

  if (loading) return <p className="config-hint">Loading pipelines…</p>;
  if (error) return <p className="config-hint warning"><AlertTriangle size={13}/> {error}</p>;
  if (pipelines.length < 2) {
    return (
      <p className="config-hint">
        This business unit has one lead pipeline, so every branch appears in it.
      </p>
    );
  }

  return (
    <>
      <p className="config-hint">
        {selected.length === 0
          ? 'This branch appears in every lead pipeline. Tick pipelines to show it only in those.'
          : `This branch appears only in the ${selected.length} pipeline${selected.length === 1 ? '' : 's'} ticked below. Untick them all to show it everywhere again.`}
      </p>
      <div className="branch-pipeline-options">
        {pipelines.map(pipeline => {
          const on = selected.includes(Number(pipeline.id));
          return (
            <label key={pipeline.id} className={`branch-pipeline-option${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(Number(pipeline.id))}/>
              <GitBranch size={13}/>
              <span>{pipeline.displayName}</span>
            </label>
          );
        })}
      </div>
      {!branchId && (
        <p className="config-hint">Save the branch first; visibility is stored once it exists.</p>
      )}
    </>
  );
}

/**
 * Persist what the section collected.
 *
 * Runs after the branch is saved, because a new branch has no id until then,
 * and only when the selection actually changed -- the endpoint is
 * administrator-only, so an untouched section must stay silent rather than
 * fail the whole save for someone who only edited a phone number.
 */
export async function saveBranchPipelines(branchId, value) {
  if (!branchId || !value?.loaded) return;
  const before = [...(value.original || [])].sort().join(',');
  const after = [...(value.pipelineIds || [])].sort().join(',');
  if (before === after) return;
  await api(`/branches/${branchId}/pipelines`, {
    method: 'PUT',
    body: JSON.stringify({ pipelineIds: value.pipelineIds || [] }),
  });
}
