// SMS length helper shared by the notice and document request panels
// SMS segments: GSM-7 (160 per SMS, 153 per part; ^{}[]~\|€ count twice), anything else UCS-2 (70 / 67)
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
export const smsSegments = (text) => {
    if (GSM.test(text)) {
        const units = [...text].reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0);
        return units <= 160 ? 1 : Math.ceil(units / 153);
    }
    const units = [...text].length;
    return units <= 70 ? 1 : Math.ceil(units / 67);
};
