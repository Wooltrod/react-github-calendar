'use client'

import { forwardRef, useCallback, useEffect, useState } from 'react'
import Calendar, {
  Skeleton,
  type Props as ActivityCalendarProps,
  type ThemeInput,
} from 'react-activity-calendar'
import { transformData } from './lib'
import type { Activity, ApiErrorResponse, ApiResponse, Year } from './types'

export type Props = {
  username: string
  errorMessage?: string
  throwOnError?: boolean
  transformData?: (data: Array<Activity>) => Array<Activity>
  transformTotalCount?: boolean
  year?: Year
} & Omit<ActivityCalendarProps, 'data'>

async function fetchCalendarData(username: string, year: Year): Promise<ApiResponse> {
  const repoOwner = 'Wooltrod'
  const repoName = 'Hungarian_Self_Learning'

  const since = new Date()
  since.setFullYear(typeof year === 'number' ? year : since.getFullYear() - 1)
  since.setHours(0, 0, 0, 0)
  const sinceISO = since.toISOString()

  const query = `
    query($owner: String!, $name: String!, $since: GitTimestamp!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(since: $since, first: 100) {
                edges {
                  node {
                    committedDate
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        owner: repoOwner,
        name: repoName,
        since: sinceISO,
      },
    }),
  })

  const json = await response.json()

  if (!response.ok || json.errors) {
    throw Error(json.errors?.[0]?.message ?? 'Failed to fetch GitHub GraphQL data.')
  }

  const commits = json.data.repository?.defaultBranchRef?.target?.history?.edges || []

  // Group by date
  const dateMap: Record<string, number> = {}

  for (const { node } of commits) {
    const date = node.committedDate.split('T')[0]
    dateMap[date] = (dateMap[date] || 0) + 1
  }

  const contributions: Activity[] = Object.entries(dateMap).map(([date, count]) => {
    let level: Activity['level'] = 0
    if (count >= 10) level = 4
    else if (count >= 5) level = 3
    else if (count >= 3) level = 2
    else if (count >= 1) level = 1
    return { date, count, level }
  })

  // Construct a fake total for this year
  const totalCount = contributions.reduce((sum, c) => sum + c.count, 0)
  const currentYear = new Date().getFullYear()

  return {
    total: {
      [typeof year === 'number' ? year : currentYear]: totalCount,
    },
    contributions,
  }
}


const GitHubCalendar = forwardRef<HTMLElement, Props>(
  (
    {
      username,
      year = 'last',
      labels,
      transformData: transformFn,
      transformTotalCount = true,
      throwOnError = false,
      errorMessage = `Error – Fetching GitHub contribution data for "${username}" failed.`,
      ...props
    },
    ref,
  ) => {
    const [data, setData] = useState<ApiResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const fetchData = useCallback(() => {
      setLoading(true)
      setError(null)
      fetchCalendarData(username, year)
        .then(setData)
        .catch((err: unknown) => {
          if (err instanceof Error) {
            setError(err)
          }
        })
        .finally(() => {
          setLoading(false)
        })
    }, [username, year])

    useEffect(fetchData, [fetchData])

    // React error boundaries can't handle asynchronous code, so rethrow.
    if (error) {
      if (throwOnError) {
        throw error
      } else {
        return <div>{errorMessage}</div>
      }
    }

    if (loading || !data) {
      return <Skeleton {...props} loading />
    }

    const theme = props.theme ?? gitHubTheme

    const defaultLabels = {
      totalCount: `{{count}} contributions in ${year === 'last' ? 'the last year' : '{{year}}'}`,
    }

    const totalCount = year === 'last' ? data.total.lastYear : data.total[year]

    return (
      <Calendar
        data={transformData(data.contributions, transformFn)}
        labels={Object.assign({}, defaultLabels, labels)}
        ref={ref}
        totalCount={transformFn && transformTotalCount ? undefined : totalCount}
        {...props}
        theme={theme}
        loading={Boolean(props.loading) || loading}
        maxLevel={4}
      />
    )
  },
)

GitHubCalendar.displayName = 'GitHubCalendar'

const gitHubTheme = {
  light: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  dark: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
} satisfies ThemeInput

export default GitHubCalendar
