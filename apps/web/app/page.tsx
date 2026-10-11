import { Greeting } from "./greeting";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Fern</h1>
        <Greeting />
      </main>
    </div>
  );
}
