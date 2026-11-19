
import React, { useState, useEffect } from 'react';
import { CompanyData } from '../types';
import { defaultMaintenancePct } from '../utils/math';
import { currencySymbol } from '../utils/currency';

interface Props {
  company: CompanyData;
  onApply: (value: number) => void;
  onClose: () => void;
}

const OwnersEarningsCalculator: React.FC<Props> = ({ company, onApply, onClose }) => {
  // Use normalized values as defaults if available
  const initialWC = company.ttmFinancials?.normalizedWorkingCapital ?? company.ttmFinancials?.changeInWorkingCapital ?? 0;
  const initialCapex = company.ttmFinancials?.normalizedCapex ?? company.ttmFinancials?.capitalExpenditures ?? 0;

  // State for inputs (in Millions)
  const [netIncome, setNetIncome] = useState(company.ttmFinancials?.netIncome || 0);
  const [depreciation, setDepreciation] = useState(company.ttmFinancials?.depreciation || 0);
  const [sbc, setSbc] = useState(company.ttmFinancials?.stockBasedCompensation || 0);
  const [capex, setCapex] = useState(initialCapex);
  const [workingCapital, setWorkingCapital] = useState(initialWC);
  const [useNormalizedWC, setUseNormalizedWC] = useState(true); // Default to normalized
  const [useNormalizedCapex, setUseNormalizedCapex] = useState(true); // Track if using average
  const [maintenancePct, setMaintenancePct] = useState(() => defaultMaintenancePct(company)); // Suggested %, else D&A / CapEx
  const [shares, setShares] = useState(company.sharesOutstanding || 1);

  const cur = currencySymbol(company.currency).trim();
  const normalizedWC = company.ttmFinancials?.normalizedWorkingCapital;
  const normalizedCapex = company.ttmFinancials?.normalizedCapex;

  // Suggested Maintenance CapEx (from AI)
  const suggestedPct = company.ttmFinancials?.suggestedMaintenanceCapexPct;
  // Depr / CapEx Ratio (Common Proxy)
  const deprToCapex = capex > 0 ? Math.min(Math.round((depreciation / capex) * 100), 100) : 0;

  // Derived values
  const currentWC = useNormalizedWC && normalizedWC !== undefined ? normalizedWC : workingCapital;
  // If user changes the input manually, we'll stop calling it "normalized"
  const maintenanceCapex = (capex * (maintenancePct / 100));
  
  // Intermediate: Cash Flow from Operations (Approx)
  // We add SBC back to show the standard Cash Flow number first
  const cashFlowFromOps = netIncome + depreciation + sbc + currentWC;

  // Owner's Earnings Calculation
  // Subtract SBC again because we treat it as a real expense (dilution)
  const ownersEarningsTotal = cashFlowFromOps - maintenanceCapex - sbc;
  
  // Math check: Millions / Millions = Per Share (dollars)
  const ownersEarningsPerShare = shares > 0 ? ownersEarningsTotal / shares : 0;

  return (
    <div className="bg-nomad-900/90 backdrop-blur-md border border-yellow-500/30 rounded-xl p-4 md:p-6 mb-8 relative animate-in fade-in slide-in-from-top-4 shadow-2xl">
      <button 
        onClick={onClose}
        className="absolute top-3 right-3 md:top-4 md:right-4 text-nomad-500 hover:text-nomad-200 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 md:w-6 md:h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="mb-6 md:mb-8 border-b border-nomad-700/50 pb-4">
        <h3 className="text-lg md:text-xl font-serif text-yellow-500 mb-2 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 md:w-6 md:h-6">
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Owner's Earnings Calculator
        </h3>
        <p className="text-nomad-400 text-xs md:text-sm">
          Adjusting GAAP earnings to reflect true cash available to owners.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        
        {/* Inputs */}
        <div className="lg:col-span-7 space-y-4 md:space-y-5">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-nomad-800/50 p-3 md:p-4 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors group">
              <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500 mb-1 md:mb-2 group-focus-within:text-yellow-500">Net Income ({cur}M)</label>
              <input 
                type="number" 
                value={netIncome.toFixed(0)} 
                onChange={(e) => setNetIncome(parseFloat(e.target.value) || 0)}
                className="w-full bg-transparent text-lg md:text-xl text-nomad-100 font-mono focus:outline-none" 
              />
            </div>
            <div className="bg-nomad-800/50 p-3 md:p-4 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors group">
              <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500 mb-1 md:mb-2 group-focus-within:text-yellow-500">Shares (M)</label>
              <div className="flex items-center">
                <span className="text-nomad-600 mr-2">/</span>
                <input 
                  type="number" 
                  value={shares.toFixed(0)} 
                  onChange={(e) => setShares(parseFloat(e.target.value) || 1)}
                  className="w-full bg-transparent text-lg md:text-xl text-nomad-100 font-mono focus:outline-none" 
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-nomad-800/50 p-3 md:p-4 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors group">
              <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500 mb-1 md:mb-2 group-focus-within:text-green-500">D&A ({cur}M)</label>
              <div className="flex items-center">
                <span className="text-green-500/70 mr-2">+</span>
                <input 
                  type="number" 
                  value={depreciation.toFixed(0)} 
                  onChange={(e) => setDepreciation(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent text-lg md:text-xl text-nomad-100 font-mono focus:outline-none" 
                />
              </div>
            </div>
             <div className="bg-nomad-800/50 p-3 md:p-4 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors group">
              <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500 mb-1 md:mb-2 group-focus-within:text-green-500">Stock Comp ({cur}M)</label>
              <div className="flex items-center">
                <span className="text-green-500/70 mr-2">+</span>
                <input 
                  type="number" 
                  value={sbc.toFixed(0)} 
                  onChange={(e) => setSbc(parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent text-lg md:text-xl text-nomad-100 font-mono focus:outline-none" 
                />
              </div>
            </div>
          </div>

          <div className="bg-nomad-800/50 p-3 md:p-4 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors group relative">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
              <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500 group-focus-within:text-yellow-500">Change in Working Cap ({cur}M)</label>
              {normalizedWC !== undefined && (
                <button 
                  onClick={() => setUseNormalizedWC(!useNormalizedWC)}
                  className={`text-[9px] md:text-[10px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                    useNormalizedWC 
                    ? 'bg-yellow-500 text-nomad-950 border-yellow-400' 
                    : 'bg-nomad-900/50 text-nomad-400 border-nomad-700 hover:border-nomad-500'
                  }`}
                >
                  {useNormalizedWC ? 'Using 5Y Average' : 'Normalize (5Y)'}
                </button>
              )}
            </div>
            <div className="flex items-center">
                <span className="text-nomad-600 mr-2">±</span>
              <input 
                type="number" 
                value={currentWC.toFixed(0)} 
                onChange={(e) => {
                  setWorkingCapital(parseFloat(e.target.value) || 0);
                  setUseNormalizedWC(false);
                }}
                className={`w-full bg-transparent text-lg md:text-xl font-mono focus:outline-none transition-colors ${useNormalizedWC ? 'text-yellow-500' : 'text-nomad-100'}`} 
              />
            </div>            {useNormalizedWC && (
              <div className="mt-4 space-y-2">
                <div className="text-[9px] md:text-[10px] text-yellow-600 font-bold uppercase tracking-wider">Historical ΔWC ({cur}M)</div>
                <div className="flex gap-1 items-end h-10 md:h-12 bg-nomad-900/30 rounded p-1">
                  {company.financials?.map((f, idx) => {
                    const val = (f.changeInWorkingCapital || 0);
                    // Scale relative to the max absolute value in the historical range
                    const allVals = company.financials?.map(x => Math.abs((x.changeInWorkingCapital || 0))) || [1];
                    const max = Math.max(...allVals, 1);
                    const height = (Math.abs(val) / max) * 100;
                    return (
                      <div key={idx} className="flex-1 h-full flex flex-col justify-end items-center group relative" title={`${f.year}`}>
                        <div 
                          className={`w-full rounded-t-sm transition-all ${val >= 0 ? 'bg-green-500/60 hover:bg-green-400' : 'bg-red-500/60 hover:bg-red-400'}`}
                          style={{ height: `${Math.max(height, 5)}%` }}
                        ></div>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-nomad-800 text-[8px] px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 border border-nomad-600 shadow-xl">
                          {f.year}: {val > 0 ? '+' : ''}{val.toFixed(0)}M
                        </div>
                      </div>
                    );
                   })}
                </div>
                <div className="text-[9px] md:text-[10px] text-yellow-600 font-medium pt-1">
                  5-Year Average: {normalizedWC?.toFixed(0)}M
                </div>
              </div>
            )}
          </div>

          <div className="bg-nomad-800/50 p-4 md:p-5 rounded-lg border border-nomad-700/50 hover:border-nomad-600 transition-colors relative">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-baseline gap-2 mb-3">
               <div className="flex items-center gap-2">
                 <label className="block text-[10px] md:text-xs uppercase tracking-wider text-nomad-500">CapEx ({cur}M)</label>
                 {normalizedCapex !== undefined && (
                   <span className={`text-[8px] uppercase px-1 rounded border ${useNormalizedCapex ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' : 'bg-nomad-900 text-nomad-500 border-nomad-700'}`}>
                     {useNormalizedCapex ? '5Y Avg Active' : 'Historical Avg Available'}
                   </span>
                 )}
               </div>
               <div className="flex items-center gap-2">
                 {/* Smart Suggestion Button */}
                 {suggestedPct !== undefined && (
                   <button 
                     onClick={() => setMaintenancePct(suggestedPct)}
                     className="text-[9px] md:text-[10px] bg-yellow-900/30 text-yellow-500 border border-yellow-700/50 px-2 py-0.5 rounded hover:bg-yellow-900/50 transition-colors flex items-center gap-1"
                     title={`Greenwald estimate: capex minus the capex needed for growth (PP&E/sales × sales growth). Depreciation/CapEx is ${deprToCapex}%.`}
                   >
                     <span className="animate-pulse">✨</span> Suggested: {suggestedPct}%
                   </button>
                 )}
                 <div className="text-[10px] md:text-xs text-yellow-600 font-medium bg-nomad-900/30 px-2 py-1 rounded">
                   Maint: {maintenancePct}%
                 </div>
               </div>
            </div>
            <div className="flex items-center mb-4">
                <span className="text-red-500/70 mr-2">-</span>
                <input 
                  type="number" 
                  value={capex.toFixed(0)} 
                  onChange={(e) => {
                    setCapex(parseFloat(e.target.value) || 0);
                    setUseNormalizedCapex(false);
                  }}
                  className={`w-full bg-transparent text-lg md:text-xl font-mono focus:outline-none ${useNormalizedCapex ? 'text-yellow-500' : 'text-nomad-100'}`} 
                />
            </div>
            <input 
               type="range" 
               min="0" 
               max="100" 
               value={maintenancePct} 
               onChange={(e) => setMaintenancePct(Number(e.target.value))}
               className="w-full accent-yellow-500 h-1 bg-nomad-700 rounded-lg appearance-none cursor-pointer"
            />
             <div className="flex justify-between items-center mt-2">
               <span className="text-[9px] md:text-[10px] text-nomad-500">
                 Depr/CapEx: <span className="text-nomad-400">{deprToCapex}%</span>
               </span>
               <p className="text-[9px] md:text-[10px] text-nomad-500">
                 Maint. CapEx: <span className="text-red-400 font-mono">-{cur}{maintenanceCapex.toFixed(0)}M</span>
              </p>
             </div>

            {/* Historical CapEx Chart */}
            <div className="mt-4 pt-4 border-t border-nomad-700/30 space-y-2">
                <div className="text-[9px] md:text-[10px] text-nomad-500 font-bold uppercase tracking-wider">Historical CapEx ({cur}M)</div>
                <div className="flex gap-1 items-end h-10 bg-nomad-900/30 rounded p-1">
                  {company.financials?.filter(f => f.capex !== undefined).map((f, idx) => {
                    const val = (f.capex || 0);
                    const allVals = company.financials?.map(x => (x.capex || 0)) || [1];
                    const max = Math.max(...allVals, 1);
                    const height = (val / max) * 100;
                    return (
                      <div key={idx} className="flex-1 h-full flex flex-col justify-end items-center group relative" title={`${f.year}`}>
                        <div 
                          className="w-full bg-red-500/60 rounded-t-sm transition-all hover:bg-red-400"
                          style={{ height: `${Math.max(height, 5)}%` }}
                        ></div>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-nomad-800 text-[8px] px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 border border-nomad-600 shadow-xl">
                          {f.year}: {val.toFixed(0)}M
                        </div>
                      </div>
                    );
                   })}
                </div>
                <div className="flex gap-1 text-[8px] text-nomad-600 font-mono">
                  {company.financials?.filter(f => f.capex !== undefined).map((f, idx) => (
                    <span key={idx} className="flex-1 text-center">{f.year.slice(2)}: {(f.capex || 0).toFixed(0)}</span>
                  ))}
                </div>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="lg:col-span-5 flex flex-col">
            <div className="flex-1 bg-nomad-800 rounded-xl border border-nomad-700 shadow-inner p-4 md:p-6 flex flex-col justify-between relative overflow-hidden">
               <div className="absolute top-0 right-0 p-20 bg-yellow-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
               
               <div className="relative z-10 space-y-1 text-[10px] md:text-xs text-nomad-400 mb-6 font-mono">
                 <div className="flex justify-between p-1 px-2"><span>Net Income</span> <span>{cur}{netIncome.toFixed(0)}M</span></div>
                 <div className="flex justify-between p-1 px-2 text-green-400/80"><span>+ D&A</span> <span>+{cur}{depreciation.toFixed(0)}M</span></div>
                 <div className="flex justify-between p-1 px-2 text-green-400/80">
                    <span>+ SBC (Add back)</span> 
                    <span>+{cur}{sbc.toFixed(0)}M</span>
                 </div>
                 <div className="flex justify-between p-1 px-2">
                    <span>{useNormalizedWC ? '± Normalized Work. Cap' : '± Work. Cap'}</span> 
                    <span className={useNormalizedWC ? 'text-yellow-500' : ''}>{currentWC > 0 ? '+' : ''}{currentWC.toFixed(0)}M</span>
                 </div>
                 <div className="border-t border-nomad-600 my-1 mx-2"></div>
                 <div className="flex justify-between p-1 px-2 text-nomad-200 font-bold bg-nomad-900/40 rounded"><span>= Cash From Ops</span> <span>{cur}{cashFlowFromOps.toFixed(0)}M</span></div>
                 <div className="h-2"></div>
                 <div className="flex justify-between p-1 px-2 text-red-400/80"><span>- Maint. CapEx</span> <span>-{cur}{maintenanceCapex.toFixed(0)}M</span></div>
                 <div className="flex justify-between p-1 px-2 text-red-400/80 font-medium bg-red-900/10 rounded">
                    <span>- SBC (Real Cost)</span> 
                    <span>-{cur}{sbc.toFixed(0)}M</span>
                 </div>
                 <div className="border-t border-nomad-500 my-2 pt-2 mx-2 flex justify-between text-white font-bold text-sm md:text-base">
                   <span>Total OE ({cur}M)</span> <span>{cur}{ownersEarningsTotal.toFixed(0)}M</span>
                 </div>
               </div>

               <div className="text-center relative z-10 mt-4 pt-6 border-t border-nomad-700/50">
                 <div className="text-nomad-500 text-[9px] md:text-[10px] uppercase tracking-widest mb-2">Owner's Earnings Per Share</div>
                 <div className="text-4xl md:text-5xl font-serif text-yellow-500 tracking-tight drop-shadow-lg">
                    <span className="text-xl md:text-2xl align-top opacity-50 mr-1">{cur}</span>
                    {ownersEarningsPerShare.toFixed(2)}
                 </div>
               </div>
            </div>

            <button
                onClick={() => onApply(ownersEarningsPerShare)}
                className="w-full mt-4 bg-yellow-500 hover:bg-yellow-400 text-nomad-950 font-bold py-3 md:py-4 px-6 rounded-xl transition-all shadow-lg shadow-yellow-900/20 transform active:scale-[0.98] text-sm md:text-base"
            >
                Use This Value
            </button>
        </div>
      </div>
    </div>
  );
};

export default OwnersEarningsCalculator;
