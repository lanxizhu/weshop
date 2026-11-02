import { zodResolver } from '@hookform/resolvers/zod'
import { CircleCheck, KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { changeAdminPassword } from '@/lib/api'
import { setToken } from '@/lib/auth'

const schema = z.object({
  oldPassword: z.string().min(1, '请输入旧密码'),
  newPassword: z.string()
    .min(8, '新密码长度不能少于 8 位')
    .refine(value => /[a-z]/i.test(value) && /\d/.test(value), '新密码必须同时包含字母和数字'),
  confirmPassword: z.string().min(1, '请再次输入新密码'),
}).refine(values => values.newPassword === values.confirmPassword, {
  message: '两次输入的新密码不一致',
  path: ['confirmPassword'],
})

type Values = z.infer<typeof schema>

export default function ChangePassword() {
  const [successMessage, setSuccessMessage] = useState('')
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
  })
  const submitting = form.formState.isSubmitting

  async function onSubmit(values: Values) {
    form.clearErrors('root')
    setSuccessMessage('')
    try {
      const result = await changeAdminPassword(values.oldPassword, values.newPassword)
      setToken(result.token)
      form.reset()
      setSuccessMessage(result.message)
    }
    catch (e) {
      form.setError('root', { message: e instanceof Error ? e.message : '密码修改失败，请重试' })
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start">
      <section className="space-y-5 md:pt-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="size-5" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">账号安全</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            定期更新管理员密码，降低账号被长期盗用的风险。
          </p>
        </div>
        <div className="border-l-2 border-primary/30 pl-4 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">修改成功后</p>
          <p>当前设备会保持登录，其他设备的登录态将全部失效。</p>
        </div>
      </section>

      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <CardTitle>修改密码</CardTitle>
          </div>
          <CardDescription>验证当前密码后设置新密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="oldPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>旧密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="请输入当前使用的密码"
                        autoComplete="current-password"
                        disabled={submitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>新密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="设置新的登录密码"
                        autoComplete="new-password"
                        disabled={submitting}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>至少 8 位，且同时包含字母和数字。</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>确认新密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="再次输入新密码"
                        autoComplete="new-password"
                        disabled={submitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {successMessage && (
                <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm" role="status">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p>{successMessage}</p>
                </div>
              )}
              {form.formState.errors.root && (
                <p className="text-sm text-destructive" role="alert">
                  {form.formState.errors.root.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? (
                      <>
                        <Spinner aria-hidden="true" />
                        正在修改…
                      </>
                    )
                  : '确认修改'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  )
}
