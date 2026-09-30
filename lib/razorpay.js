import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import {AppError} from './db.js';

export function razorpayClient(keyId,secret) {
  if (!keyId||!secret) throw new AppError('Razorpay credentials are not configured.',503,'RAZORPAY_NOT_CONFIGURED');
  if(process.env.NODE_ENV==='production'&&!String(keyId).startsWith('rzp_live_')) throw new AppError('Production payments require live Razorpay credentials.',503,'RAZORPAY_LIVE_KEY_REQUIRED');
  const client=new Razorpay({key_id:keyId,key_secret:secret});
  Object.assign(client.api.rq.defaults,{timeout:15000,maxContentLength:2_000_000,maxBodyLength:1_000_000,maxRedirects:0});
  return client;
}

export function verifyRazorpaySignature(raw,signature,secret) {
  if (!secret||!/^[a-f0-9]{64}$/i.test(signature||'')) throw new AppError('Invalid Razorpay webhook signature.',403,'RAZORPAY_SIGNATURE_INVALID');
  const expected=crypto.createHmac('sha256',secret).update(raw).digest();
  if (!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'))) throw new AppError('Invalid Razorpay webhook signature.',403,'RAZORPAY_SIGNATURE_INVALID');
}

export function razorpayRequestRejected(error){
  return [400,401,403,404,422,429].includes(Number(error?.statusCode));
}

export function paymentMinorUnits(value,currency) {
  if (!/^[A-Z]{3}$/.test(currency||'')||!/^\d{1,12}(?:\.\d{1,6})?$/.test(String(value))) throw new AppError('Invalid payment amount or currency.',400,'PAYMENT_AMOUNT_INVALID');
  if(!Intl.supportedValuesOf('currency').includes(currency)) throw new AppError('Unknown payment currency.',400,'PAYMENT_CURRENCY_UNSUPPORTED');
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  if (![0,2,3].includes(digits)) throw new AppError('Unsupported payment currency precision.',400,'PAYMENT_CURRENCY_UNSUPPORTED');
  const [whole,fraction='']=String(value).split('.');
  if (/[1-9]/.test(fraction.slice(digits))) throw new AppError('The order amount cannot be represented exactly in this currency.',400,'PAYMENT_PRECISION_INVALID');
  const amount=BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.slice(0,digits).padEnd(digits,'0')||'0');
  if (amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER)||(digits===3&&amount%10n!==0n)) throw new AppError('Invalid payment amount for this currency.',400,'PAYMENT_AMOUNT_INVALID');
  return Number(amount);
}

export function razorpayCheckoutUrl(value) {
  let url;try {url=new URL(value);}catch {throw new AppError('Razorpay returned no usable checkout URL.',502,'PAYMENT_URL_INVALID');}
  if (url.protocol!=='https:'||url.username||url.password||!['rzp.io','rzp.me','razorpay.com','checkout.razorpay.com'].includes(url.hostname)) throw new AppError('Razorpay returned an unexpected checkout host.',502,'PAYMENT_URL_INVALID');
  return url.href;
}

export function paymentLinkState(link,checkout) {
  if (!/^plink_[A-Za-z0-9]+$/.test(link?.id||'')||link.reference_id!==checkout.id||Number(link.amount)!==Number(checkout.amount_minor)||link.currency!==checkout.currency) throw new AppError('Provider payment does not match this checkout.',409,'PAYMENT_LINK_MISMATCH');
  if (link.status==='paid'&&Number(link.amount_paid)===Number(checkout.amount_minor)) return 'captured';
  if (['cancelled','expired'].includes(link.status)) return link.status;
  if (['created','partially_paid'].includes(link.status)) return 'pending';
  throw new AppError('Payment status is not confirmed.',409,'PAYMENT_STATUS_UNCONFIRMED');
}
