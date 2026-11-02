import type { UserListItem } from '@weshop/shared'
import { Ban, CircleCheck, MapPin, Users as UsersIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UserDetailDrawer } from '@/components/user-detail-drawer'
import { fetchUsers, onServerRecover, setUserStatus } from '@/lib/api'

const fmtTime = (s: string) => s?.slice(0, 16) ?? '-'

export default function Users() {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [statusTarget, setStatusTarget] = useState<UserListItem | null>(null)
  const [acting, setActing] = useState(false)

  // 详情抽屉展示数据直接取自当前列表，禁用/恢复等操作可实时同步
  const viewing = viewingId == null ? null : (users.find(u => u.id === viewingId) ?? null)

  const load = useCallback(async () => {
    const { users } = await fetchUsers()
    setUsers(users)
    setLoading(false)
  }, [])

  useEffect(() => {
    load().catch((e) => {
      setLoading(false)
      toast.error(e instanceof Error ? e.message : '加载失败')
    })
  }, [load])

  // 服务从故障中恢复后，自动刷新数据
  useEffect(() => {
    return onServerRecover(() => {
      toast.success('服务已恢复，正在同步最新数据')
      load().catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
    })
  }, [load])

  async function handleSetStatus() {
    if (!statusTarget)
      return
    const next = statusTarget.status === 'disabled' ? 'normal' : 'disabled'
    setActing(true)
    try {
      const { user } = await setUserStatus(statusTarget.id, next)
      toast.success(next === 'disabled' ? `已禁用「${statusTarget.nick_name}」` : `已恢复「${statusTarget.nick_name}」`)
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, status: user.status } : u)))
      setStatusTarget(null)
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
    finally {
      setActing(false)
    }
  }

  const totalAddresses = users.reduce((sum, u) => sum + u.address_count, 0)

  return (
    <>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">注册用户</CardTitle>
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{users.length}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">收货地址总数</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalAddresses}</div>}
            </CardContent>
          </Card>
        </div>

        <p className="text-sm text-muted-foreground">
          小程序端微信登录（开发环境为 Mock）后自动注册；此处展示全部用户及其收货地址数量。点击行可查看用户详情。
        </p>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">ID</TableHead>
                <TableHead>昵称</TableHead>
                <TableHead className="w-[28%]">openid</TableHead>
                <TableHead>地址数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full max-w-[140px]" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )
                : users.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                          暂无用户，小程序端登录后自动出现在这里
                        </TableCell>
                      </TableRow>
                    )
                  : (
                      users.map(u => (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          title="查看详情"
                          onClick={() => setViewingId(u.id)}
                        >
                          <TableCell className="text-muted-foreground">{u.id}</TableCell>
                          <TableCell className="font-medium">{u.nick_name}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{u.openid}</TableCell>
                          <TableCell>{u.address_count}</TableCell>
                          <TableCell>
                            {u.status === 'disabled'
                              ? <Badge variant="destructive">已禁用</Badge>
                              : <Badge variant="outline">正常</Badge>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{fmtTime(u.created_at)}</TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={u.status === 'disabled' ? undefined : 'text-destructive hover:text-destructive'}
                              onClick={() => setStatusTarget(u)}
                            >
                              {u.status === 'disabled'
                                ? (
                                    <>
                                      <CircleCheck className="mr-1 h-4 w-4" />
                                      恢复
                                    </>
                                  )
                                : (
                                    <>
                                      <Ban className="mr-1 h-4 w-4" />
                                      禁用
                                    </>
                                  )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
            </TableBody>
          </Table>
        </Card>
      </main>

      <UserDetailDrawer
        user={viewing}
        open={viewingId !== null}
        onOpenChange={o => !o && setViewingId(null)}
      />

      <AlertDialog open={!!statusTarget} onOpenChange={o => !o && setStatusTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.status === 'disabled' ? '确认恢复该用户？' : '确认禁用该用户？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.status === 'disabled'
                ? `恢复后「${statusTarget?.nick_name}」可正常登录和使用小程序。`
                : `禁用后「${statusTarget?.nick_name}」将无法登录和使用小程序。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSetStatus}
              disabled={acting}
              className={statusTarget?.status === 'disabled' ? undefined : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              {statusTarget?.status === 'disabled' ? '恢复' : '禁用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
