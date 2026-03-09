import Image from "next/image";
import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-[#1a2425]">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-icon.png"
            alt=""
            width={123}
            height={48}
            unoptimized
            priority
          />
          <Image
            src="/logo-wordmark.png"
            alt="Twin Cities Tee Times"
            width={88}
            height={48}
            unoptimized
            priority
          />
        </Link>
      </div>
    </nav>
  );
}
