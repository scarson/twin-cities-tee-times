// ABOUTME: Top navigation bar with site logo and wordmark.
// ABOUTME: Dark-themed fixed header used across all pages.
import Image from "next/image";
import Link from "next/link";
import { NavAuthArea } from "./nav-auth-area";

const NAV_LINK_CLASS =
  "text-sm font-medium text-gray-300 hover:text-white lg:text-base";

function NavLinks({ className }: { className: string }) {
  return (
    <div className={className}>
      <Link href="/courses" className={NAV_LINK_CLASS}>
        Courses
      </Link>
      <Link href="/about" className={NAV_LINK_CLASS}>
        About
      </Link>
    </div>
  );
}

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-[#1a2425]">
      <div className="mx-auto max-w-2xl px-4 py-3 lg:max-w-3xl">
        <div className="flex items-center justify-between gap-4">
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
              className="h-10 w-auto lg:h-12"
              unoptimized
              priority
            />
          </Link>
          <NavLinks className="hidden items-center gap-4 sm:flex" />
          <NavAuthArea />
        </div>
        <NavLinks className="mt-3 flex items-center gap-6 sm:hidden" />
      </div>
    </nav>
  );
}
