import { blockAttrs } from '@/lib/sections/blockAttrs';

interface TeamMember {
  name: string;
  role: string;
  bio?: string;
}

interface TeamGridSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    members: TeamMember[];
    variant?: 'grid' | 'compact' | 'card-with-social' | 'centered';
  };
}

export default function TeamGridSection({ data }: TeamGridSectionProps) {
  const variant = data.variant || 'grid';

  if (variant === 'card-with-social') {
    return (
      <section {...blockAttrs('team-grid')} className="section-padding" aria-labelledby="team-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="team-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {data.members?.map((member, index) => (
              <div key={index} className="overflow-hidden rounded-xl bg-white shadow-sm">
                <div className="h-2 bg-gradient-to-r from-primary-500 to-accent-500 rounded-t-xl" />
                <div className="p-8 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                    <span className="text-2xl font-bold">{member.name.charAt(0)}</span>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-gray-900">{member.name}</h3>
                  <p className="mt-1 text-sm font-medium text-primary-600">{member.role}</p>
                  {member.bio && (
                    <p className="mt-3 text-sm leading-relaxed text-gray-600">{member.bio}</p>
                  )}
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <span className="h-8 w-8 rounded-full bg-gray-200" />
                    <span className="h-8 w-8 rounded-full bg-gray-200" />
                    <span className="h-8 w-8 rounded-full bg-gray-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'centered') {
    return (
      <section {...blockAttrs('team-grid')} className="section-padding" aria-labelledby="team-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="team-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-2xl">
            {data.members?.map((member, index) => (
              <div key={index} className={`py-10 text-center ${index < (data.members?.length ?? 0) - 1 ? 'border-b border-gray-200' : ''}`}>
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <span className="text-3xl font-bold">{member.name.charAt(0)}</span>
                </div>
                <h3 className="mt-4 text-2xl font-semibold text-gray-900">{member.name}</h3>
                <p className="mt-1 font-medium text-accent-600">{member.role}</p>
                {member.bio && (
                  <p className="mt-3 leading-relaxed text-gray-600">{member.bio}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'compact') {
    return (
      <section {...blockAttrs('team-grid')} className="section-padding" aria-labelledby="team-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="team-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.members?.map((member, index) => (
              <div key={index} className="flex items-center gap-4 rounded-lg border border-gray-200 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <span className="text-lg font-bold">{member.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{member.name}</p>
                  <p className="text-sm text-gray-500">{member.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('team-grid')} className="bg-gray-50 section-padding" aria-labelledby="team-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="team-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {data.members?.map((member, index) => (
            <div key={index} className="rounded-xl bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                <span className="text-2xl font-bold">{member.name.charAt(0)}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold text-gray-900">{member.name}</h3>
              <p className="mt-1 text-sm font-medium text-primary-600">{member.role}</p>
              {member.bio && (
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{member.bio}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
