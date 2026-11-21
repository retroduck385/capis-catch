// Where to fix what a reviewer marked Needs revision (group notes item 33, 2026-11-22). Pure, for the return banner
// on the Financial Package and the credit scoring page, and the tests.
//   returnTargets(decision, checkItems, sources) -> [{ code, label, remark, path, hash, place, canFix }]
// sources = CHECK_SOURCES (reviewChecks.js): each item's `there` is the page (and section) the Credit Officer works
// on. Documents live in the AO's loan folder: the CO can open it, but the AO makes the fix (canFix false).

export const returnTargets = (decision, checkItems, sources) => (decision?.review_decision_items ?? [])
    .filter((i) => i.result === 'NEEDS_REVISION')
    .map((i) => {
        const there = sources[i.item_code]?.there ?? null;
        return {
            code: i.item_code,
            label: checkItems.find((c) => c.code === i.item_code)?.label ?? i.item_code,
            remark: i.remark || null,
            path: there?.path ?? null,
            hash: there?.hash ?? null,
            place: there?.label ?? null,
            canFix: Boolean(there) && there.path !== '/loanFolderPage',
        };
    });
