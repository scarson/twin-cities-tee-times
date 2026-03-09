// ABOUTME: Top navigation bar with site logo and wordmark.
// ABOUTME: Dark-themed fixed header used across all pages.
import Image from "next/image";
import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-[#1a2425]">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 lg:max-w-3xl">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-wordmark.png"
            alt="Twin Cities Tee Times"
            width={854}
            height={365}
            className="h-10 w-auto lg:h-12"
            unoptimized
            priority
          />
          <Image
            src="/logo-icon.png"
            alt=""
            width={854}
            height={333}
            className="h-12 w-auto lg:h-14"
            unoptimized
            priority
          />
        </Link>
      </div>
    </nav>
  );
}
