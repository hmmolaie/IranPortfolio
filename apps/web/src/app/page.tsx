import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16">
        <p className="mb-4 text-sm font-medium tracking-[0.2em] text-gold-500">SABADYAR</p>
        <h1 className="max-w-3xl text-5xl font-bold leading-tight text-navy-900 sm:text-7xl">
          سبدیار
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-navy-800/75">
          کشف سبد بهینه برای بازار ایران — سهام، طلا، سپرده و اختیار؛ با تحلیل صندوق‌ها و شرایط اقتصاد
          کشور.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/register" className="btn-primary">
            شروع رایگان
          </Link>
          <Link href="/login" className="btn-secondary">
            ورود
          </Link>
        </div>
        <p className="mt-16 max-w-lg text-sm text-navy-800/50">
          این سرویس ابزار تصمیم‌یار است و جایگزین مشاوره رسمی سرمایه‌گذاری نیست.
        </p>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-1/2 hidden w-1/2 bg-[linear-gradient(135deg,#0b1f3a_0%,#16325c_55%,#a8893e_140%)] opacity-90 lg:block"
      />
    </div>
  );
}
