import {notFound} from 'next/navigation';
import {MessageCircle} from 'lucide-react';
import {publicWebview} from '@/lib/whatsapp-webviews';
import TransactionalWebview from '@/components/transactional-webview';
import HostedWebviewForm from '@/components/hosted-webview-form';
import styles from './page.module.css';

export const dynamic='force-dynamic';
export default async function WhatsAppHostedPage({params}) {
  const {viewId}=await params;
  const view=await publicWebview(viewId);
  if (!view) notFound();
  if(view.flow_id)return <TransactionalWebview viewId={view.id} title={view.title} businessName={view.business_name}/>;
  if (view.mode === 'form') {
    return (
      <HostedWebviewForm
        viewId={view.id}
        title={view.title}
        description={view.description}
        businessName={view.business_name}
        buttonLabel={view.button_label}
        fields={view.formSchema || []}
        successMessage={view.successMessage}
      />
    );
  }
  return <main className={styles.page}><section className={styles.content}>
    <div className={styles.brand}><MessageCircle size={24} aria-hidden="true"/><span>{view.business_name}</span></div>
    <h1>{view.title}</h1>
    <p>{view.description}</p>
    <a className={styles.action} href={view.url} rel="noopener noreferrer"><MessageCircle size={20} aria-hidden="true"/>{view.button_label}</a>
  </section></main>;
}
