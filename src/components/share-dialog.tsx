"use client";
// ABOUTME: Confirmation dialog shown when a user opens a share-favorites link.
// ABOUTME: Lists the shared courses and offers Accept/Cancel before merging.

interface ShareDialogProps {
  courses: { id: string; name: string }[];
  onAccept: () => void;
  onCancel: () => void;
}

export function ShareDialog({ courses, onAccept, onCancel }: ShareDialogProps) {
  const count = courses.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Add {count} {count === 1 ? "course" : "courses"} to your favorites?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Someone shared their favorite courses with you:
        </p>
        <ul className="mt-3 space-y-1">
          {courses.map((course) => (
            <li
              key={course.id}
              className="rounded px-2 py-1 text-sm text-gray-700 bg-stone-50"
            >
              {course.name}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-3">
          <button
            onClick={onAccept}
            className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Add to favorites
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
