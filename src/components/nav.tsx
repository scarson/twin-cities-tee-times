import Image from "next/image";
import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-[#1a2425]">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Twin Cities Tee Times"
            width={140}
            height={78}
            priority
          />
        </Link>
      </div>
    </nav>
  );
}
