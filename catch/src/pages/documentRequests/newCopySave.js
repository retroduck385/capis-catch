// "Needs a new copy" (newCopyDialog.jsx): save the mark, then (send = true) send the applicant the request.
// The two steps are separate database calls, so the mark can be saved while the request fails (for example a
// request is already waiting for the applicant). Then:
//   - the page's File status is refreshed at once (onMarked), so the mark shows as saved;
//   - the message says the mark was saved and only the request was not sent;
//   - trying again only sends the request: the mark is not saved a second time (alreadyMarked).
// No Supabase import here (markFile / openRequest are passed in), so the node tests can run it.
//
// Returns { marked, sent, error }: error is null when everything asked for went through.
export const saveNewCopy = async ({ markFile, openRequest, onMarked, documentId, comment, applicationId, message, items, send, alreadyMarked = false }) => {
    let marked = alreadyMarked;
    try {
        if (!marked) {
            await markFile(documentId, 'NEEDS_NEW_COPY', comment);
            marked = true;
            onMarked?.();
        }
        if (send) await openRequest(applicationId, message, items);
        return { marked, sent: Boolean(send), error: null };
    } catch (err) {
        return { marked, sent: false, error: marked ? sendFailedText(err?.message) : (err?.message ?? 'Something went wrong') };
    }
};

export const sendFailedText = (reason) =>
    `The mark "Needs a new copy" is saved and shows in File status. The request to the applicant was not sent${reason ? `: ${reason}` : '.'}`;
