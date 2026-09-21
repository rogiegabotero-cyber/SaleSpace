import './App.css'

export default function PageLoading({ text = 'Loading...', children }) {
  return <main className="page-loading"><div className="page-loading-inner"><span className="loading-spinner" /><p>{text}</p>{children}</div></main>
}
