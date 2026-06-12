/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import { subscribeSfData } from '../services/sfDataService';

const EMPTY_STATE = {
  opportunities: [],
  selfConsumption: [],
  maintenances: [],
  syncMeta: null,
  loading: true,
};

const SfDataContext = createContext(null);

/**
 * Provides Salesforce data (opportunities / self-consumption / maintenances)
 * streamed from Firestore. `loading` is true until the first snapshot arrives.
 */
export function SfDataProvider({ children }) {
  const [data, setData] = useState(EMPTY_STATE);

  useEffect(() => {
    return subscribeSfData((next) => setData({ ...next, loading: false }));
  }, []);

  return (
    <SfDataContext.Provider value={data}>
      {children}
    </SfDataContext.Provider>
  );
}

export function useSfData() {
  const context = useContext(SfDataContext);
  if (!context) {
    throw new Error('useSfData must be used within an SfDataProvider');
  }
  return context;
}
