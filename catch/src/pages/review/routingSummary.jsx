// Read-only VII. Approval routing: approval authority, reviewers in order, approver/s.
// rows = review_assignments rows (inactive ones are ignored); names = { [user_id]: name }
import { splitRouting, tierLabel } from './approval';

const RoutingSummary = ({ tier, rows, names, myId }) => {
    const { reviewers, approvers } = splitRouting(rows);
    const nameOf = (r) => `${names[r.user_id] ?? 'Unknown'}${r.user_id === myId ? ' (you)' : ''}`;

    if (reviewers.length === 0 && approvers.length === 0) return <p className="italic">Not sent for review yet.</p>;
    return (
        <div>
            <p><span className="font-semibold">Approval authority:</span> {tierLabel(tier) ?? '—'}</p>
            <p className="font-semibold pt-1">Reviewed by (in order)</p>
            <ol className="list-decimal pl-6">
                {reviewers.map((r) => <li key={r.id ?? r.user_id}>{nameOf(r)}</li>)}
            </ol>
            <p className="font-semibold pt-1">Approved by</p>
            <ul className="list-disc pl-6">
                {approvers.map((r) => <li key={r.id ?? r.user_id}>{nameOf(r)}</li>)}
            </ul>
        </div>
    );
};

export default RoutingSummary;
