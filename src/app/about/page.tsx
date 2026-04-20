// ABOUTME: FAQ-style page explaining how the app works for end users.
// ABOUTME: Covers data freshness, polling schedule, favorites, sharing, and sign-in.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How It Works – Twin Cities Tee Times",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
      <h1 className="text-2xl font-bold lg:text-3xl">How It Works</h1>
      <p className="mt-2 text-gray-600 lg:text-lg">
        Frequently asked questions about Twin Cities Tee Times.
      </p>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            What is Twin Cities Tee Times?
          </h2>
          <p className="mt-2 text-gray-700">
            A one-stop view of available tee times across public golf courses in
            the Twin Cities metro. We automatically check each course&rsquo;s
            booking system so you don&rsquo;t have to visit every site
            individually.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            How fresh is the data?
          </h2>
          <p className="mt-2 text-gray-700">
            Tee times are checked automatically on a schedule. Dates closer to
            today are checked more frequently:
          </p>
          <table className="mt-3 w-full text-sm lg:text-base">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-2 pr-4 font-medium">What&rsquo;s checked</th>
                <th className="py-2 font-medium">How often</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4">Today &amp; tomorrow</td>
                <td className="py-2">
                  Every 5–15 min (5am–8pm CT), hourly overnight
                </td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4">2–7 days out</td>
                <td className="py-2">Every 30 min, hourly overnight</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">8–14 days out</td>
                <td className="py-2">
                  Every hour (for courses that publish this far out)
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-gray-700">
            You can always hit the <strong>Refresh</strong> button with your
            dates selected to get the latest info immediately.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            What do the time filters mean?
          </h2>
          <p className="mt-2 text-gray-700">
            The time-of-day buttons above the tee time list narrow results to
            when you want to play:
          </p>
          <table className="mt-3 w-full text-sm lg:text-base">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-2 pr-4 font-medium">Filter</th>
                <th className="py-2 font-medium">Hours</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4">Early</td>
                <td className="py-2">5:00 AM – 8:00 AM</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4">Morning</td>
                <td className="py-2">8:00 AM – 11:00 AM</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4">Afternoon</td>
                <td className="py-2">11:00 AM – 3:00 PM</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Late</td>
                <td className="py-2">After 3:00 PM</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-gray-700">
            Pick <strong>Any</strong> to show all times.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            What does &ldquo;stale&rdquo; mean?
          </h2>
          <p className="mt-2 text-gray-700">
            Tee times that haven&rsquo;t been updated in a while are marked as
            stale. The data might still be accurate, but you should refresh or
            check the course&rsquo;s booking site directly to be sure.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            Can I book through this app?
          </h2>
          <p className="mt-2 text-gray-700">
            No &mdash; the <strong>Book</strong> buttons link directly to each
            course&rsquo;s booking site. We show you what&rsquo;s available, and
            you book where you normally would.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            What do Favorites do?
          </h2>
          <p className="mt-2 text-gray-700">
            Mark courses as favorites and the home page will filter to show just
            those courses&rsquo; tee times. You can toggle between your
            favorites and all courses at any time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            How do I share my favorites?
          </h2>
          <p className="mt-2 text-gray-700">
            On the home page, click <strong>Favorites</strong> to open the
            dropdown, then click <strong>Share favorites</strong>. This copies a
            link to your clipboard that you can send to anyone. When they open
            it, they&rsquo;ll be prompted to add your courses to their own
            favorites.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            Do I need to sign in?
          </h2>
          <p className="mt-2 text-gray-700">
            Signing in is never required. Without an account, your favorites are
            saved in your browser. If you sign in with Google, your favorites
            sync across devices so you can check tee times on your phone and
            computer with the same list.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            What data do you collect?
          </h2>
          <p className="mt-2 text-gray-700">
            Without signing in, we store nothing about you &mdash; your
            favorites live only in your browser&rsquo;s local storage.
          </p>
          <p className="mt-2 text-gray-700">
            When you sign in with Google, we store your name and email address
            along with your favorites and booking clicks. We don&rsquo;t share
            this data with anyone.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            How does location filtering work?
          </h2>
          <p className="mt-2 text-gray-700">
            You can filter courses by distance from your location. Two options
            are available: using your device&rsquo;s GPS, or entering a zip
            code.
          </p>
          <p className="mt-2 text-gray-700">
            <strong>GPS:</strong> Your precise coordinates are used only in your
            browser to calculate distances. They are never sent to our servers
            or stored anywhere &mdash; not even in your browser&rsquo;s local
            storage.
          </p>
          <p className="mt-2 text-gray-700">
            <strong>Zip code:</strong> If you enter a zip code, it&rsquo;s
            saved in your browser so you don&rsquo;t have to re-enter it.
            Distance is calculated entirely in your browser using the zip
            code&rsquo;s approximate center point.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold lg:text-xl">
            How do I delete my account?
          </h2>
          <p className="mt-2 text-gray-700">
            Go to any page, click your name in the top-right corner, and select{" "}
            <strong>Delete account</strong>. This permanently removes all your
            data from our servers &mdash; your profile, synced favorites, and
            booking click history. Your local favorites are not affected and will
            still be available in your browser.
          </p>
        </section>

      </div>

      {process.env.NEXT_PUBLIC_BUILD_SHA && (
        <p className="mt-12 text-center text-xs text-gray-400">
          Build: {process.env.NEXT_PUBLIC_BUILD_SHA}
          {process.env.NEXT_PUBLIC_BUILD_TIME
            ? `-${process.env.NEXT_PUBLIC_BUILD_TIME}`
            : ""}
        </p>
      )}
    </main>
  );
}
