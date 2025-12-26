
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SheetService } from '../services/sheetService';
import { Order, OrderStatus, Currency, RankType, OrderItem } from '../types';
import { Pagination } from './Pagination';
import { 
  Search, RefreshCw, ChevronRight, FileText, 
  History, X, CheckCircle2, Ban, Loader2,
  ArrowUp, ArrowDown, ArrowUpDown, Edit2, Check, AlertCircle
} from 'lucide-react';

interface ActionLog {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'success' | 'error';
}

interface AdminModalState {
  type: 'ANNUL' | 'VALIDATION';
  orderId?: string;
  missingItems?: string[];
}

// UNIFIED GRID COLUMNS DEFINITION
const GRID_COLS = "grid-cols-[80px_100px_1fr_60px_120px_110px_110px_90px_30px]";

export const AdminInterface: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);
  
  // Edit Mode State
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ [key: string]: string }>({}); 
  
  const [successToast, setSuccessToast] = useState<{message: string, id: string} | null>(null);

  const [adminModal, setAdminModal] = useState<AdminModalState | null>(null);
  const [refusalReason, setRefusalReason] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const interactionLock = useRef<number>(0);

  // --- HELPER FOR LOGS ---
  const addLog = (text: string, type: 'info' | 'success' | 'error') => {
      const log: ActionLog = {
          id: Date.now().toString() + Math.random(),
          time: new Date().toLocaleTimeString(),
          text,
          type
      };
      setLogs(prev => [log, ...prev].slice(0, 50));
  };

  const fetchData = async (silent = false) => {
    if (silent && Date.now() - interactionLock.current < 10000) return;
    if (silent && SheetService.isLocked()) return;
    if (!silent) setLoading(true);
    setIsSyncing(true);
    try {
      const data = await SheetService.getOrders(true);
      setOrders(data);
      setError(null);
    } catch(e: any) { 
      addLog("Ошибка загрузки данных", "error");
      setError(e.toString());
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
      fetchData();
      const interval = setInterval(() => fetchData(true), 30000);
      return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, sortConfig]);

  const handleSort = (key: string) => {
      // Logic: Collapse expanded row to prevent jumping visual bugs
      setExpandedId(null);
      
      setSortConfig(current => {
          if (current?.key === key) {
              return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
          }
          return { key, direction: 'asc' };
      });
  };

  // --- FILTERING & SORTING ---
  const filteredOrders = useMemo(() => {
      let result = orders.filter(o => {
          const isClosed = o.status === OrderStatus.CLOSED || o.readyToBuy || o.isRefused;
          if (activeTab === 'open' && isClosed) return false;
          if (activeTab === 'closed' && !isClosed) return false;
          
          if (searchQuery) {
              const q = searchQuery.toLowerCase();
              return o.id.toLowerCase().includes(q) || 
                     o.vin.toLowerCase().includes(q) || 
                     o.clientName.toLowerCase().includes(q) ||
                     o.items.some(i => i.name.toLowerCase().includes(q));
          }
          return true;
      });

      if (sortConfig) {
        result.sort((a, b) => {
            let aVal: any = '';
            let bVal: any = '';
            
            if (sortConfig.key === 'id') { aVal = Number(a.id); bVal = Number(b.id); }
            else if (sortConfig.key === 'date') { 
                const parseD = (d: string) => {
                    const [day, month, year] = d.split(/[\.\,]/);
                    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
                };
                aVal = parseD(a.createdAt); bVal = parseD(b.createdAt); 
            }
            else if (sortConfig.key === 'year') {
                aVal = a.car?.AdminYear || a.car?.year || ''; 
                bVal = b.car?.AdminYear || b.car?.year || '';
            }
            else if (sortConfig.key === 'client') { aVal = a.clientName; bVal = b.clientName; }
            else if (sortConfig.key === 'offers') {
                aVal = (a.offers || []).length;
                bVal = (b.offers || []).length;
            }
            else if (sortConfig.key === 'status') {
                // Custom Status Weight for Archive
                const getStatusWeight = (o: Order) => {
                    if (o.readyToBuy) return 4; // КУПЛЕНО (Top priority in approved)
                    if (o.isProcessed) return 3; // ГОТОВО
                    if (o.isRefused) return 2; // ОТКАЗ
                    return 1; // Просто закрыт/Открыт
                };
                aVal = getStatusWeight(a);
                bVal = getStatusWeight(b);
            }
            
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
      }
      return result;
  }, [orders, activeTab, searchQuery, sortConfig]);
  
  const paginatedOrders = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return filteredOrders.slice(start, start + itemsPerPage);
  }, [filteredOrders, currentPage, itemsPerPage]);

  // --- ACTIONS ---

  const handleUpdateRank = async (offerId: string, itemName: string, currentRank: RankType, vin: string, adminPrice?: number, adminCurrency?: Currency, adminComment?: string) => {
      interactionLock.current = Date.now();
      const newAction = currentRank === 'ЛИДЕР' || currentRank === 'LEADER' ? 'RESET' : undefined;
      
      // Optimistic update
      setOrders(prev => prev.map(o => {
          if (o.vin !== vin) return o;
          return {
              ...o,
              offers: o.offers?.map(off => ({
                  ...off,
                  items: off.items.map(i => {
                      if (i.name === itemName) {
                          if (off.id === offerId) {
                              return { ...i, rank: newAction === 'RESET' ? 'РЕЗЕРВ' : 'ЛИДЕР' as RankType, adminPrice, adminCurrency, adminComment };
                          } else {
                              // If setting leader, reset others
                              if (!newAction) return { ...i, rank: 'РЕЗЕРВ' as RankType };
                          }
                      }
                      return i;
                  })
              }))
          };
      }));

      try {
          await SheetService.updateRank(vin, itemName, offerId, adminPrice, adminCurrency, newAction, adminComment);
          addLog(`Обновлен ранг для ${itemName}`, 'success');
      } catch (e) {
          addLog("Ошибка обновления ранга", "error");
          fetchData(true); // Revert on error
      }
  };

  const handleFormCP = async (orderId: string) => {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      // VALIDATION: Check if every item has a Leader
      const itemNames = order.items.map(i => (i.AdminName || i.name).trim().toLowerCase());
      const coveredItems = new Set<string>();
      
      order.offers?.forEach(off => {
          off.items.forEach(i => {
              if (i.rank === 'ЛИДЕР' || i.rank === 'LEADER') {
                  coveredItems.add(i.name.trim().toLowerCase());
              }
          });
      });

      const missing = order.items.filter(i => !coveredItems.has((i.AdminName || i.name).trim().toLowerCase()));

      if (missing.length > 0) {
          setAdminModal({
              type: 'VALIDATION',
              orderId: orderId,
              missingItems: missing.map(i => i.AdminName || i.name)
          });
          return;
      }

      executeApproval(orderId);
  };

  const executeApproval = async (orderId: string) => {
      setAdminModal(null);
      setIsSubmitting(orderId);
      
      // Optimistic Update - INSTANT REACTION
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, isProcessed: true, status: OrderStatus.CLOSED } : o));
      setSuccessToast({ message: "КП Утверждено!", id: Date.now().toString() });

      try {
          await SheetService.formCP(orderId);
          addLog(`КП сформировано для ${orderId}`, 'success');
          setTimeout(() => setSuccessToast(null), 3000);
      } catch (e) {
          addLog("Ошибка формирования КП", "error");
          fetchData(true); // Revert on error
      } finally {
          setIsSubmitting(null);
      }
  };

  const handleRefuse = async () => {
      if (!adminModal?.orderId) return;
      setIsSubmitting(adminModal.orderId);
      try {
          await SheetService.refuseOrder(adminModal.orderId, refusalReason, 'ADMIN');
          addLog(`Заказ ${adminModal.orderId} аннулирован`, 'success');
          setAdminModal(null);
          setRefusalReason("");
          
          setOrders(prev => prev.map(o => o.id === adminModal.orderId ? { ...o, isRefused: true, status: OrderStatus.CLOSED } : o));
          
      } catch (e) {
          addLog("Ошибка отказа", "error");
      } finally {
          setIsSubmitting(null);
      }
  };

  const startEditing = (order: Order) => {
      setEditingOrderId(order.id);
      const form: any = {};
      
      // Car fields
      form[`car_model`] = order.car?.AdminModel || order.car?.model || '';
      form[`car_year`] = order.car?.AdminYear || order.car?.year || '';
      form[`car_body`] = order.car?.AdminBodyType || order.car?.bodyType || '';
      
      // Items fields
      order.items.forEach((item, idx) => {
          form[`item_${idx}_name`] = item.AdminName || item.name;
          form[`item_${idx}_qty`] = item.AdminQuantity || item.quantity;
      });
      
      setEditForm(form);
  };

  const saveEditing = async (order: Order) => {
      setIsSubmitting(order.id);
      const newItems = order.items.map((item, idx) => ({
          ...item,
          AdminName: editForm[`item_${idx}_name`],
          AdminQuantity: Number(editForm[`item_${idx}_qty`]),
          car: {
              ...order.car,
              AdminModel: editForm[`car_model`],
              AdminYear: editForm[`car_year`],
              AdminBodyType: editForm[`car_body`]
          }
      }));

      // Optimistic Update
      setOrders(prev => prev.map(o => {
          if (o.id === order.id) {
              return {
                  ...o,
                  car: { ...o.car, AdminModel: editForm[`car_model`], AdminYear: editForm[`car_year`], AdminBodyType: editForm[`car_body`] } as any,
                  items: newItems
              };
          }
          return o;
      }));

      try {
          await SheetService.updateOrderJson(order.id, newItems);
          addLog(`Заказ ${order.id} обновлен`, 'success');
          setEditingOrderId(null);
      } catch (e) {
          addLog("Ошибка сохранения", "error");
          fetchData(true);
      } finally {
          setIsSubmitting(null);
      }
  };

  // Helper for Sort Icons
  const SortIcon = ({ column }: { column: string }) => {
      if (sortConfig?.key !== column) return <ArrowUpDown size={10} className="text-slate-300 ml-1 opacity-50 group-hover:opacity-100 transition-opacity" />;
      return sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-indigo-600 ml-1" /> : <ArrowDown size={10} className="text-indigo-600 ml-1" />;
  };

  return (
      <div className="max-w-6xl mx-auto p-4 space-y-4">
          {successToast && (
             <div className="fixed top-6 right-6 z-50 bg-slate-800 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2 animate-in slide-in-from-top-4 fade-in duration-300">
                 <CheckCircle2 className="text-emerald-400" size={16}/> {successToast.message}
             </div>
          )}
          
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-4">
                  <h1 className="text-lg font-black uppercase text-slate-800">Панель Администратора</h1>
                  <button onClick={() => setShowLogs(!showLogs)} className={`p-2 rounded-lg ${showLogs ? 'bg-slate-200' : 'bg-slate-50'} hover:bg-slate-200 transition-colors`}>
                      <History size={18} className="text-slate-600"/>
                  </button>
              </div>
          </div>

          {showLogs && (
              <div className="bg-slate-900 text-slate-300 p-4 rounded-xl max-h-40 overflow-y-auto text-xs font-mono">
                  {logs.map(log => (
                      <div key={log.id} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : ''}`}>
                          [{log.time}] {log.text}
                      </div>
                  ))}
                  {logs.length === 0 && <div className="text-slate-600 italic">Логов пока нет...</div>}
              </div>
          )}

          {/* LARGE SEARCH BAR LIKE SELLER */}
          <div className="relative group flex items-center">
              <Search className="absolute left-6 text-slate-400" size={20}/>
              <input 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Поиск по VIN или ID..."
                  className="w-full pl-14 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:border-indigo-300 shadow-sm transition-all"
              />
          </div>

          <div className="flex justify-between items-end border-b border-slate-200">
              <div className="flex gap-4">
                  <button onClick={() => setActiveTab('open')} className={`pb-2 text-sm font-bold uppercase border-b-2 transition-colors ${activeTab === 'open' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400'}`}>Активные</button>
                  <button onClick={() => setActiveTab('closed')} className={`pb-2 text-sm font-bold uppercase border-b-2 transition-colors ${activeTab === 'closed' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400'}`}>Архив / Закрытые</button>
              </div>
              <button onClick={() => fetchData()} className="mb-2 p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all flex items-center gap-2">
                  <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""}/>
              </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
             {/* HEADER WITH SORTING - Hidden on Mobile */}
             <div className={`hidden md:grid ${GRID_COLS} gap-3 p-4 border-b border-slate-100 items-center bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-wider select-none`}>
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort('id')}>ID <SortIcon column="id"/></div>
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort('client')}>Марка <SortIcon column="client"/></div> 
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort('client')}>Модель</div>
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort('year')}>Год <SortIcon column="year"/></div>
                 <div>VIN</div>
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort('client')}>Клиент</div>
                 {/* DYNAMIC HEADER LABEL: OFFERS OR STATUS */}
                 <div className="cursor-pointer flex items-center group" onClick={() => handleSort(activeTab === 'open' ? 'offers' : 'status')}>
                     {activeTab === 'open' ? 'ОФФЕРЫ' : 'СТАТУС'} <SortIcon column={activeTab === 'open' ? 'offers' : 'status'}/>
                 </div>
                 <div className="cursor-pointer flex items-center justify-end group" onClick={() => handleSort('date')}>Дата <SortIcon column="date"/></div>
                 <div></div> {/* Placeholder for Chevron */}
             </div>

             {paginatedOrders.map(order => {
                 const isExpanded = expandedId === order.id;
                 const isEditing = editingOrderId === order.id;
                 const offersCount = order.offers ? order.offers.length : 0;
                 const hasOffers = offersCount > 0;
                 
                 // Parsing Car Data
                 const carBrand = (order.car?.AdminModel || order.car?.model || '').split(' ')[0];
                 const carModel = (order.car?.AdminModel || order.car?.model || '').split(' ').slice(1).join(' ');
                 const carYear = order.car?.AdminYear || order.car?.year;

                 return (
                 <div key={order.id} className={`transition-all duration-300 border-l-4 ${isExpanded ? 'border-l-indigo-600 ring-1 ring-indigo-600 shadow-xl bg-white relative z-10 rounded-xl my-4' : 'border-l-transparent border-b-4 md:border-b border-slate-100 hover:bg-slate-50'}`}>
                     {/* ROW - Responsive Grid */}
                     <div className={`grid grid-cols-1 md:${GRID_COLS} gap-2 md:gap-3 p-4 items-center cursor-pointer text-[10px]`} onClick={() => !isEditing && setExpandedId(expandedId === order.id ? null : order.id)}>
                         
                         {/* ID + Mobile Header */}
                         <div className="flex items-center justify-between md:justify-start">
                             <div className="font-mono font-bold text-slate-700 flex items-center gap-2">
                                <span className="md:hidden text-slate-400 w-12 shrink-0">ID:</span>
                                {order.id}
                             </div>
                             <div className="md:hidden flex items-center gap-2">
                                {order.isRefused ? (
                                    <span className="inline-flex px-2 py-1 rounded bg-red-100 text-red-600 font-black uppercase text-[8px] whitespace-nowrap">АННУЛИРОВАН</span>
                                ) : order.readyToBuy ? (
                                    <span className="inline-flex px-2 py-1 rounded bg-emerald-600 text-white font-black uppercase text-[8px] whitespace-nowrap">КУПЛЕНО</span>
                                ) : order.isProcessed ? (
                                    <span className="inline-flex px-2 py-1 rounded bg-indigo-600 text-white font-black uppercase text-[8px] whitespace-nowrap">КП УТВЕРЖДЕНО</span>
                                ) : (
                                    <span className={`inline-flex px-2 py-1 rounded font-black uppercase text-[8px] whitespace-nowrap ${hasOffers ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-400'}`}>
                                        {offersCount} ОФФЕРОВ
                                    </span>
                                )}
                                <ChevronRight size={16} className={`text-slate-400 transition-transform ${expandedId === order.id ? 'rotate-90 text-indigo-600' : ''}`}/>
                             </div>
                         </div>

                         {/* BRAND */}
                         <div className="font-bold text-slate-900 uppercase truncate flex items-center gap-2">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">Марка:</span>
                            {carBrand}
                         </div>

                         {/* MODEL */}
                         <div className="font-bold text-slate-700 uppercase truncate flex items-center gap-2">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">Модель:</span>
                            {carModel}
                         </div>

                         {/* YEAR */}
                         <div className="font-bold text-slate-500 flex items-center gap-2">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">Год:</span>
                            {carYear}
                         </div>

                         {/* VIN */}
                         <div className="font-mono text-slate-500 truncate flex items-center gap-2">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">VIN:</span>
                            {order.vin}
                         </div>

                         {/* CLIENT */}
                         <div className="font-bold text-slate-500 uppercase truncate flex items-center gap-2">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">Клиент:</span>
                            {order.clientName}
                         </div>
                         
                         {/* OFFERS / STATUS BADGE (Desktop Only) */}
                         <div className="hidden md:block">
                             {order.isRefused ? (
                                <span className="inline-flex px-2 py-1 rounded bg-red-100 text-red-600 font-black uppercase text-[8px] whitespace-nowrap">АННУЛИРОВАН</span>
                             ) : order.readyToBuy ? (
                                <span className="inline-flex px-2 py-1 rounded bg-emerald-600 text-white font-black uppercase text-[8px] whitespace-nowrap">КУПЛЕНО</span>
                             ) : order.isProcessed ? (
                                <span className="inline-flex px-2 py-1 rounded bg-indigo-600 text-white font-black uppercase text-[8px] whitespace-nowrap">КП УТВЕРЖДЕНО</span>
                             ) : (
                                <span className={`inline-flex px-2 py-1 rounded font-black uppercase text-[8px] whitespace-nowrap ${hasOffers ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-400'}`}>
                                    {offersCount} ОФФЕРОВ
                                </span>
                             )}
                         </div>

                         {/* DATE */}
                         <div className="text-left md:text-right font-bold text-slate-400 flex items-center gap-2 md:block">
                            <span className="md:hidden text-slate-400 w-12 shrink-0">Дата:</span>
                            {order.createdAt.split(/[\n,]/)[0]}
                         </div>

                         {/* CHEVRON (Desktop Only) */}
                         <div className="hidden md:flex justify-end">
                            <ChevronRight size={16} className={`text-slate-400 transition-transform ${expandedId === order.id ? 'rotate-90 text-indigo-600' : ''}`}/>
                         </div>
                     </div>
                     
                     {isExpanded && (
                         <div className="p-6 bg-slate-50 border-t border-slate-100 rounded-b-xl cursor-default">
                             
                             {/* DETAILS HEADER */}
                             <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 shadow-sm">
                                <div className="flex items-center gap-2 mb-3">
                                    <FileText size={14} className="text-slate-400"/>
                                    <span className="text-[10px] font-black uppercase text-slate-500">Детали заказа</span>
                                </div>
                                
                                {isEditing ? (
                                    <div className="grid grid-cols-6 gap-4">
                                        <div className="col-span-1 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase">Марка/Модель</label><input value={editForm['car_model']} onChange={e => setEditForm({...editForm, 'car_model': e.target.value})} className="w-full p-2 border rounded text-xs font-bold uppercase"/></div>
                                        <div className="col-span-1 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase">Год</label><input value={editForm['car_year']} onChange={e => setEditForm({...editForm, 'car_year': e.target.value})} className="w-full p-2 border rounded text-xs font-bold"/></div>
                                        <div className="col-span-1 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase">Кузов</label><input value={editForm['car_body']} onChange={e => setEditForm({...editForm, 'car_body': e.target.value})} className="w-full p-2 border rounded text-xs font-bold uppercase"/></div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-7 gap-3 md:gap-6 text-[10px]">
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Клиент</span><span className="font-black text-indigo-600 uppercase text-sm">{order.clientName}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Телефон</span><span className="font-bold text-slate-700">{order.clientPhone || "-"}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">VIN</span><span className="font-mono font-bold text-slate-600">{order.vin}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Модель</span><span className="font-black text-slate-800 uppercase">{order.car?.AdminModel || order.car?.model}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Марка</span><span className="font-bold text-slate-700 uppercase">{carBrand}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Год</span><span className="font-bold text-slate-700">{order.car?.AdminYear || order.car?.year}</span></div>
                                        <div><span className="block text-[8px] font-bold text-slate-400 uppercase mb-1">Кузов</span><span className="font-bold text-slate-700 uppercase">{order.car?.AdminBodyType || order.car?.bodyType || '-'}</span></div>
                                    </div>
                                )}
                             </div>

                             {/* ITEMS & OFFERS LIST */}
                             <div className="space-y-4">
                                 {order.items.map((item, idx) => {
                                     // Find offers for this item
                                     const itemOffers: { offerId: string, clientName: string, item: OrderItem }[] = [];
                                     order.offers?.forEach(off => {
                                         const matchingItem = off.items.find(i => i.name === item.name);
                                         if (matchingItem && (matchingItem.offeredQuantity || 0) > 0) {
                                             itemOffers.push({
                                                 offerId: off.id,
                                                 clientName: off.clientName,
                                                 item: matchingItem
                                             });
                                         }
                                     });

                                     return (
                                         <div key={idx} className="bg-slate-900 rounded-xl overflow-hidden shadow-md">
                                             {/* ITEM HEADER */}
                                             <div className="p-3 flex items-center justify-between text-white border-b border-slate-700">
                                                 <div className="flex items-center gap-3">
                                                     {isEditing ? (
                                                         <div className="flex gap-2">
                                                             <input value={editForm[`item_${idx}_name`]} onChange={e => setEditForm({...editForm, [`item_${idx}_name`]: e.target.value})} className="bg-slate-800 text-white px-2 py-1 rounded border border-slate-600 text-xs font-bold uppercase w-64"/>
                                                             <input type="number" value={editForm[`item_${idx}_qty`]} onChange={e => setEditForm({...editForm, [`item_${idx}_qty`]: e.target.value})} className="bg-slate-800 text-white px-2 py-1 rounded border border-slate-600 text-xs font-bold w-16 text-center"/>
                                                         </div>
                                                     ) : (
                                                         <>
                                                            <span className="font-black text-sm uppercase tracking-wide">{item.AdminName || item.name}</span>
                                                            <span className="text-[10px] font-bold opacity-60">({item.AdminQuantity || item.quantity} ШТ)</span>
                                                         </>
                                                     )}
                                                 </div>
                                             </div>

                                             {/* OFFERS FOR THIS ITEM */}
                                             <div className="bg-white p-2 space-y-1">
                                                 {itemOffers.length > 0 ? (
                                                     itemOffers.map((off, oIdx) => {
                                                         const isLeader = off.item.rank === 'ЛИДЕР' || off.item.rank === 'LEADER';
                                                         return (
                                                             <div key={oIdx} className={`flex flex-col gap-3 p-3 rounded-lg border ${isLeader ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'}`}>
                                                                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                                     {/* SUPPLIER & BASIC INFO */}
                                                                     <div className="flex-grow">
                                                                         <div className="flex items-center gap-3 mb-1">
                                                                             <span className="font-black text-xs uppercase text-slate-800">{off.clientName}</span>
                                                                             {off.item.photoUrl && (
                                                                                 <a href={off.item.photoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[9px] font-black uppercase hover:bg-blue-100 transition-colors" title="Открыть фото">
                                                                                     <FileText size={10}/> Фото
                                                                                 </a>
                                                                             )}
                                                                         </div>
                                                                         <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
                                                                             <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-700">{off.item.sellerPrice} {off.item.sellerCurrency}</span>
                                                                             <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{off.item.offeredQuantity} шт</span>
                                                                             {off.item.weight && <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">⚖️ {off.item.weight}кг</span>}
                                                                             {off.item.deliveryWeeks && <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-100">📅 {off.item.deliveryWeeks}нед.</span>}
                                                                         </div>
                                                                     </div>

                                                                     {/* ADMIN CONTROLS */}
                                                                     <div className="flex items-center gap-2">
                                                                         <input 
                                                                            type="number" 
                                                                            placeholder={isLeader ? String(off.item.adminPrice || off.item.sellerPrice) : "Цена продажи"} 
                                                                            className="w-24 px-2 py-1.5 border border-slate-200 rounded text-center text-[10px] font-bold outline-none focus:border-indigo-500 bg-white text-slate-900"
                                                                            onChange={(e) => off.item.adminPrice = Number(e.target.value)}
                                                                            defaultValue={off.item.adminPrice || off.item.sellerPrice}
                                                                         />
                                                                         <select 
                                                                            className="w-16 px-1 py-1.5 border border-slate-200 rounded text-[10px] font-bold outline-none bg-white text-slate-900"
                                                                            defaultValue={off.item.adminCurrency || off.item.sellerCurrency}
                                                                            onChange={(e) => off.item.adminCurrency = e.target.value as Currency}
                                                                         >
                                                                             <option value="CNY">CNY</option>
                                                                             <option value="RUB">RUB</option>
                                                                             <option value="USD">USD</option>
                                                                         </select>
                                                                         <button 
                                                                            onClick={() => {
                                                                                handleUpdateRank(
                                                                                    off.offerId, 
                                                                                    item.name, 
                                                                                    off.item.rank || '', 
                                                                                    order.vin,
                                                                                    off.item.adminPrice,
                                                                                    off.item.adminCurrency,
                                                                                    off.item.adminComment
                                                                                );
                                                                            }}
                                                                            className={`w-24 py-2 rounded-lg font-black text-[9px] uppercase transition-all ${isLeader ? 'bg-emerald-500 text-white shadow-emerald-200 shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                                                         >
                                                                             {isLeader ? 'ЛИДЕР' : 'ВЫБРАТЬ'}
                                                                         </button>
                                                                     </div>
                                                                 </div>

                                                                 {/* COMMENT INPUT (Visible if not leader or always for feedback) */}
                                                                 <div className="relative">
                                                                     <input 
                                                                        type="text" 
                                                                        maxLength={90}
                                                                        placeholder="Комментарий к этой позиции (видят поставщик и клиент)..."
                                                                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-100 rounded text-[9px] font-bold outline-none focus:border-indigo-200"
                                                                        defaultValue={off.item.adminComment || ""}
                                                                        onChange={(e) => off.item.adminComment = e.target.value}
                                                                     />
                                                                     <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[7px] font-bold text-slate-300 uppercase">
                                                                         Feedback
                                                                     </div>
                                                                 </div>
                                                             </div>
                                                         );
                                                     })
                                                 ) : (
                                                     <div className="p-4 text-center text-[10px] font-bold text-slate-300 uppercase italic">Нет предложений по этой позиции</div>
                                                 )}
                                             </div>
                                         </div>
                                     );
                                 })}
                             </div>

                             {/* FOOTER ACTIONS */}
                             <div className="flex flex-wrap md:flex-nowrap justify-end gap-2 md:gap-3 mt-4 md:mt-6 pt-4 border-t border-slate-200">
                                 {isEditing ? (
                                     <>
                                        <button onClick={() => setEditingOrderId(null)} className="px-4 py-2 md:px-6 md:py-3 rounded-xl border border-slate-200 text-slate-500 font-black text-[10px] uppercase hover:bg-slate-50 flex-grow md:flex-grow-0 text-center justify-center">Отмена</button>
                                        <button onClick={() => saveEditing(order)} className="px-4 py-2 md:px-6 md:py-3 rounded-xl bg-indigo-600 text-white font-black text-[10px] uppercase shadow-lg hover:bg-indigo-700 flex items-center justify-center gap-2 flex-grow md:flex-grow-0">{isSubmitting === order.id ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>} Сохранить</button>
                                     </>
                                 ) : (
                                     <>
                                        {!order.isRefused && !order.readyToBuy && (
                                            <button onClick={() => startEditing(order)} className="px-3 py-2 md:px-4 md:py-3 rounded-xl border border-indigo-100 text-indigo-600 bg-indigo-50 font-black text-[10px] uppercase hover:bg-indigo-100 flex items-center justify-center gap-2 flex-grow md:flex-grow-0"><Edit2 size={14}/> Изменить</button>
                                        )}
                                        {!order.isRefused && (
                                            <button onClick={() => setAdminModal({ type: 'ANNUL', orderId: order.id })} className="px-3 py-2 md:px-4 md:py-3 rounded-xl border border-red-100 text-red-500 bg-red-50 font-black text-[10px] uppercase hover:bg-red-100 flex items-center justify-center gap-2 flex-grow md:flex-grow-0"><Ban size={14}/> Аннулировать</button>
                                        )}
                                        {!order.isRefused && !order.readyToBuy && (
                                            <button onClick={() => handleFormCP(order.id)} className="px-4 py-2 md:px-8 md:py-3 rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase shadow-xl hover:bg-slate-800 transition-all active:scale-95 flex-grow md:flex-grow-0 w-full md:w-auto text-center justify-center">Утвердить КП</button>
                                        )}
                                     </>
                                 )}
                             </div>
                         </div>
                     )}
                 </div>
                 );
             })}
             <Pagination totalItems={filteredOrders.length} itemsPerPage={itemsPerPage} currentPage={currentPage} onPageChange={setCurrentPage} onItemsPerPageChange={setItemsPerPage} />
          </div>
          
          {/* MODALS */}
          {adminModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                      {adminModal.type === 'VALIDATION' ? (
                          <div className="text-center space-y-4">
                              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto"><AlertCircle size={24}/></div>
                              <div>
                                  <h3 className="text-lg font-black uppercase text-slate-800">Внимание!</h3>
                                  <p className="text-xs font-bold text-slate-500 mt-2">Не выбраны поставщики для позиций:</p>
                                  <ul className="mt-2 text-[10px] font-bold text-red-500 uppercase bg-red-50 p-2 rounded-lg text-left">
                                      {adminModal.missingItems?.map(i => <li key={i}>• {i}</li>)}
                                  </ul>
                                  <p className="text-[10px] text-slate-400 mt-2">Вы уверены, что хотите утвердить неполное КП?</p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                  <button onClick={() => setAdminModal(null)} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs uppercase hover:bg-slate-200">Отмена</button>
                                  <button onClick={() => executeApproval(adminModal.orderId!)} className="py-3 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase hover:bg-indigo-700 shadow-lg shadow-indigo-200">Всё равно утвердить</button>
                              </div>
                          </div>
                      ) : (
                          <div className="space-y-4">
                              <h3 className="text-lg font-black uppercase text-slate-800">Аннулирование заказа</h3>
                              <p className="text-xs text-slate-500 font-bold">Укажите причину отказа. Это сообщение увидит клиент.</p>
                              <textarea 
                                  value={refusalReason}
                                  onChange={e => setRefusalReason(e.target.value)}
                                  className="w-full h-24 p-3 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 bg-slate-50 uppercase placeholder:normal-case"
                                  placeholder="Причина..."
                              />
                              <div className="flex gap-2 justify-end">
                                  <button onClick={() => setAdminModal(null)} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase hover:bg-slate-100 rounded-lg">Отмена</button>
                                  <button onClick={handleRefuse} className="px-4 py-2 text-xs font-bold text-white bg-red-600 uppercase rounded-lg hover:bg-red-700 shadow-lg shadow-red-200">Подтвердить</button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          )}
      </div>
  );
};
