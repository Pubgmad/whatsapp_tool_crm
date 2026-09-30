'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCcw, ShoppingBag } from 'lucide-react';
import './whatsapp-commerce.css';
import MerchantPayments from './merchant-payments';
import NativePayments from './whatsapp-native-payments';
import CommerceAutomation from './commerce-automation';

export default function WhatsAppCommerce({ api, postJson, role }) {
  const [data, setData] = useState({ orders: [], accounts: [], page: 1, hasMore: false });
  const [page, setPage] = useState(1);
  const [view, setView] = useState('orders');
  const [accountId, setAccountId] = useState('');
  const [catalogs, setCatalogs] = useState([]);
  const [catalogId, setCatalogId] = useState('');
  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [busyOrder, setBusyOrder] = useState('');
  const sequence = useRef(0);
  const productSequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setPending(true); setError('');
    try {
      const result = await api(`/api/whatsapp/commerce?page=${page}`);
      if (current !== sequence.current) return;
      setData(result);
      setAccountId((value) => result.accounts.some((account) => account.id === value) ? value : result.accounts[0]?.id || '');
    } catch (reason) { if (current === sequence.current) setError(reason.message); }
    finally { if (current === sequence.current) setPending(false); }
  }, [api, page]);
  useEffect(() => { load(); return () => { sequence.current++; }; }, [load]);
  useEffect(() => {
    let cancelled = false;
    setCatalogs([]); setCatalogId(''); setProducts([]); setCursor(null);
    if (!accountId || view !== 'catalogs') return;
    setPending(true); setError('');
    api(`/api/whatsapp/commerce?resource=catalogs&accountId=${encodeURIComponent(accountId)}`)
      .then((result) => { if (!cancelled) { setCatalogs(result.data); setCatalogId(result.data[0]?.id || ''); } })
      .catch((reason) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [accountId, view, api]);
  useEffect(() => {
    let cancelled = false;
    productSequence.current++;
    setProducts([]); setCursor(null);
    if (!catalogId || view !== 'catalogs') return;
    setPending(true); setError('');
    api(`/api/whatsapp/commerce?resource=products&accountId=${encodeURIComponent(accountId)}&catalogId=${encodeURIComponent(catalogId)}`)
      .then((result) => { if (!cancelled) { setProducts(result.data); setCursor(result.nextCursor); } })
      .catch((reason) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; productSequence.current++; };
  }, [accountId, catalogId, view, api]);
  const update = async (order, status) => {
    setBusyOrder(order.id); setError('');
    try { await postJson('/api/whatsapp/commerce', { orderId: order.id, status }); await load(); }
    catch (reason) { setError(reason.message); }
    finally { setBusyOrder(''); }
  };
  const nextProducts = async () => {
    if (!cursor || pending) return;
    const current = ++productSequence.current;
    setPending(true); setError('');
    try {
      const result = await api(`/api/whatsapp/commerce?resource=products&accountId=${encodeURIComponent(accountId)}&catalogId=${encodeURIComponent(catalogId)}&after=${encodeURIComponent(cursor)}`);
      if (current === productSequence.current) { setProducts(result.data); setCursor(result.nextCursor); }
    } catch (reason) { if (current === productSequence.current) setError(reason.message); }
    finally { if (current === productSequence.current) setPending(false); }
  };
  return <section className='commerceScreen'>
    <header className='commerceToolbar'><h2><ShoppingBag size={20} /> WhatsApp commerce</h2><div className='commerceTabs' role='tablist' aria-label='Commerce views'>
      <button type='button' role='tab' aria-selected={view === 'orders'} onClick={() => setView('orders')}>Orders</button>
      <button type='button' role='tab' aria-selected={view === 'catalogs'} onClick={() => setView('catalogs')}>Catalogs</button>
      <button type='button' role='tab' aria-selected={view === 'payments'} onClick={() => setView('payments')}>Payments</button>
      <button type='button' role='tab' aria-selected={view === 'native-payments'} onClick={() => setView('native-payments')}>Native checkout</button>
      <button type='button' role='tab' aria-selected={view === 'automation'} onClick={() => setView('automation')}>Automation</button>
    </div><button type='button' className='iconButton' title='Refresh orders' aria-label='Refresh orders' disabled={pending} onClick={load}><RefreshCcw size={18} /></button></header>
    {error && <div className='formError' role='alert'>{error}</div>}
    {pending && <div className='commerceLoading' role='status'><Loader2 size={18} className='spin' /> Loading</div>}
    {view==='payments'&&<MerchantPayments api={api} postJson={postJson} role={role} orders={data.orders}/>}
    {view==='native-payments'&&<NativePayments api={api} postJson={postJson} role={role} orders={data.orders} accounts={data.accounts}/>}
    {view==='automation'&&<CommerceAutomation api={api} postJson={postJson} role={role}/>}
    {view === 'orders' && <>
      <div className='commerceTable'><table><thead><tr><th>Customer / order</th><th>Items</th><th>Total</th><th>Payment</th><th>Fulfillment</th></tr></thead><tbody>
        {data.orders.map((order) => <tr key={order.id}><td><strong>{order.customer_phone}</strong><small>{order.reference_id || order.id}</small><small>{new Date(order.created_at).toLocaleString()}</small></td><td>{order.items.map((item, index) => <small key={`${item.retailerId}-${index}`}>{item.retailerId} x {item.quantity}</small>)}</td><td>{order.currency} {order.total_amount}</td><td>{order.payment_status}</td><td><select aria-label={`Fulfillment for ${order.id}`} value={order.fulfillment_status} disabled={Boolean(busyOrder)} onChange={(event) => update(order, event.target.value)}>{['pending', 'processing', 'shipped', 'completed', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}</select></td></tr>)}
        {!pending && !data.orders.length && <tr><td colSpan={5}>No WhatsApp orders</td></tr>}
      </tbody></table></div><footer className='commercePagination'><button className='iconButton' type='button' aria-label='Previous orders' title='Previous orders' disabled={page === 1 || pending} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={18} /></button><span>Page {data.page}</span><button className='iconButton' type='button' aria-label='Next orders' title='Next orders' disabled={!data.hasMore || pending} onClick={() => setPage((value) => value + 1)}><ChevronRight size={18} /></button></footer>
    </>}
    {view === 'catalogs' && <>
      <div className='commerceFilters'><label>WhatsApp account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value=''>Select account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.waba_id}</option>)}</select></label><label>Linked catalog<select value={catalogId} onChange={(event) => setCatalogId(event.target.value)}><option value=''>Select catalog</option>{catalogs.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name || catalog.id}</option>)}</select></label></div>
      <div className='commerceTable'><table><thead><tr><th>Product</th><th>Retailer ID</th><th>Price</th><th>Availability</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className='commerceProduct'>{product.image_url && <img src={product.image_url} alt={product.name || ''} width={48} height={48} loading='lazy' referrerPolicy='no-referrer' />}<strong>{product.name}</strong></div></td><td>{product.retailer_id}</td><td>{product.price} {product.currency}</td><td>{product.availability}</td></tr>)}{!pending && !products.length && <tr><td colSpan={4}>No products available</td></tr>}</tbody></table></div>
      <footer className='commercePagination'><button type='button' className='secondaryAction' disabled={!cursor || pending} onClick={nextProducts}>Next products <ChevronRight size={18} /></button></footer>
    </>}
  </section>;
}
