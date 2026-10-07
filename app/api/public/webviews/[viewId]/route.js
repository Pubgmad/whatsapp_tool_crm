import {publicWebviewExchange} from '@/lib/whatsapp-webview-transactions';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}){return publicWebviewExchange(request,await params);}
