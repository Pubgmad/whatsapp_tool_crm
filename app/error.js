'use client';
export default function ApplicationError({ reset }) {
  return <main className="loading errorLoading"><h1>Unable to load this page</h1><p>Please retry. Your sign-in has not been changed.</p><button className="primaryAction" onClick={reset}>Retry</button></main>;
}
