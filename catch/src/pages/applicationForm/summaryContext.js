// Display options for applicationSummary.jsx, set by a page that wants a calmer view (the staff loan folder's
// "Application details" tabs). Defaults keep the original look used by the applicant's review step.
//   stacked    each field as a label-over-value tile (a <div> per pair) instead of a two-column table
//   hideEmpty  leave out fields with nothing entered
import { createContext } from 'react';

export const SummaryContext = createContext({ stacked: false, hideEmpty: false });

// The summary's blocks, grouped for tabs: loan / parties / obligations / references / collateral
export const SUMMARY_GROUPS = ['loan', 'parties', 'obligations', 'references', 'collateral'];
