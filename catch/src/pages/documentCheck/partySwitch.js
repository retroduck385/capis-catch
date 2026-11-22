// What the Document check starts from when the officer opens another borrower's tab (documentCheckPage.jsx).
// Everything that belongs to the previous borrower's files is cleared, including the "Earlier versions" view:
// otherwise a borrower who also has replaced files opened on their earlier versions, which hides File status and
// the extracted values (Check on the document) of their current files.
export const PARTY_SWITCH_RESET = Object.freeze({ docId: null, focused: null, page: 1, view: 'current', earlierId: null });

// The file list shows the earlier versions only when they were asked for and this borrower has some
export const showsEarlier = (view, party) => view === 'earlier' && (party?.earlier?.length ?? 0) > 0;
