// The default label of a step's save button (StepButtons in fields.jsx). The applicant wizard moves on after saving
// ("Save and continue"); the loan folder stays on the section, so it provides "Save" (<StepSaveLabel.Provider value="Save">).
import { createContext } from 'react';

export const StepSaveLabel = createContext('Save and continue');
