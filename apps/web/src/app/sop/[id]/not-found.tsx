import styles from './sop-viewer.module.css';

export default function SopNotFound() {
  return (
    <main className={styles.pageShell}>
      <section className={styles.notFoundCard}>
        <p className={styles.eyebrow}>SOP draft</p>
        <h1>SOP draft not found</h1>
        <p>
          This draft may have been deleted, or the link may point to an SOP that has not been
          generated yet.
        </p>
      </section>
    </main>
  );
}
