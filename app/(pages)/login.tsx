import CustomInput from '@/components/CustomInput';
import SocialLogins from '@/components/SocialLogins';
import { API_ENDPOINTS, apiCall, getLastCredentials, saveLastCredentials, saveToken } from '@/config/api';
import { useThemeColor } from "@/hooks/use-theme-color";
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const LoginScreen = () => {
  const router = useRouter();
  const colors = useThemeColor();

  // State for Inputs and Messages
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const last = await getLastCredentials();
      if (last) {
        setEmail(last.email);
        setPassword(last.password);
      }
    })();
  }, []);

  const handleLogin = async () => {
    setMessage("");

    // Validation
    if (!email || !password) {
      setMessage("Email and Password are Required.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      setMessage("Please enter a valid email address.");
      return;
    }

    try {
      setIsSubmitting(true);
      await saveLastCredentials(email, password);
      
      const data = await apiCall(API_ENDPOINTS.LOGIN, "POST", { email, password });
      
      if (data.msg === "Login successful" && data.token) {
        // Save token for auto-login
        await saveToken(data.token);
        // Navigate to home/tabs page
        router.replace('/(tabs)');
      } else {
        setMessage(data.msg || "Login failed");
      }
    } catch (error: any) {
      setMessage(error.message || "Connection failed. Check your server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <ScrollView contentContainerStyle={[styles.scrollContainer, { backgroundColor: colors.background}]}>
        
        <View style={styles.rightSection}>
          <View style={[styles.designCircle, { backgroundColor: colors.primary }]}>
             <Image 
               source={require('../../assets/images/login1.png')}
               style={{ width: 300, height: 300, top: 100 }}
               resizeMode="contain"
             />
          </View>
        </View>

        <View style={styles.leftSection}>
          <Text style={styles.title}>Welcome Back!!</Text>
          
          <CustomInput 
            label="Email" 
            icon="📧" 
            placeholder="email@gmail.com" 
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          
          <CustomInput 
            label="Password" 
            icon="🔐" 
            placeholder="Enter your password" 
            secureTextEntry 
            value={password}
            onChangeText={setPassword}
          />

          {message ? (
            <Text style={[styles.message, { color: 'red' }]}>
              {message}
            </Text>
          ) : null}

          <TouchableOpacity style={styles.forgotBtn}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.loginBtn, isSubmitting && styles.loginBtnDisabled, { backgroundColor: colors.primary}]} 
            onPress={handleLogin}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#333" />
            ) : (
              <Text style={styles.loginBtnText}>Login</Text>
            )}
          </TouchableOpacity>

          <SocialLogins />

          <View style={styles.signupContainer}>
            <Text style={styles.questionText}>Joining new! Don&apos;t have account? </Text>
            <TouchableOpacity onPress={() => router.push('/(pages)/register')}>
              <Text style={styles.signupLink}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

  );
};

const styles = StyleSheet.create({
  message: {
    fontSize: 12,
    marginBottom: 10,
    textAlign: 'center',
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
  },
  rightSection: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  designCircle: {
    width: 300,
    height: 300,
    borderRadius: 150,
    marginTop: -75,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 40,
  },
  leftSection: {
    flex: 1,
    width: '85%',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    fontFamily: 'KshanaFont',
    marginVertical: 22,
    color: '#333',
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginRight: 10,
    marginBottom: 20,
  },
  forgotText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
  },
  loginBtn: {
    width: '90%',
    padding: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    fontSize: 22,
    fontFamily: 'KshanaFont',
    letterSpacing: 1,
  },
  signupContainer: {
    flexDirection: 'row',
    marginTop: 10,
  },
  questionText: {
    fontSize: 13,
    color: '#666',
    fontFamily: 'KshanaFont',
  },
  signupLink: {
    fontSize: 13,
    color: '#007AFF',
  },
});

export default LoginScreen;
